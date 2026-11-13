"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { z } from "zod"

import { encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"

export type ActionState = { error?: string; saved?: boolean } | null

// Empty field = keep the stored value.
const optional = <T extends z.ZodTypeAny>(t: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), t.optional())
const API_ID = "API ID — целое число с my.telegram.org."
const Fields = z.object({
  botToken: optional(
    z
      .string()
      .regex(
        /^\d+:[\w-]{30,}$/,
        "Токен бота: формат 123456:ABC…, как выдал @BotFather."
      )
  ),
  apiId: optional(
    z.coerce
      .number({ message: API_ID })
      .int(API_ID)
      .positive(API_ID)
      .max(2 ** 31 - 1, API_ID)
  ),
  apiHash: optional(
    z
      .string()
      .regex(
        /^[0-9a-f]{32}$/i,
        "API HASH — 32 шестнадцатеричных символа с my.telegram.org."
      )
  ),
})

export async function saveSettings(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  if ((await auth())?.user?.role !== "superadmin") throw new Error("Forbidden")
  const parsed = Fields.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { botToken, apiId, apiHash } = parsed.data
  const data = {
    // The bot writes the new username after it restarts with this token.
    // shortcut: re-entering the same token blanks the name until the next bot restart; compare if it annoys.
    ...(botToken && { botToken: encrypt(botToken), botUsername: null }),
    ...(apiId && { apiId }),
    ...(apiHash && { apiHash: encrypt(apiHash) }),
  }
  await db.settings.upsert({ where: { id: 1 }, create: data, update: data })
  revalidatePath("/settings")
  return { saved: true }
}

const superadmin = async () => {
  if ((await auth())?.user?.role !== "superadmin") throw new Error("Forbidden")
}

const Step = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("phone"),
    value: z
      .string()
      .transform((v) => "+" + v.replace(/\D/g, ""))
      .refine(
        (v) => /^\+\d{8,15}$/.test(v),
        "Телефон в международном формате, например +79990001122."
      ),
  }),
  z.object({
    step: z.literal("code"),
    value: z.string().trim().min(1, "Введите код из Telegram."),
  }),
  z.object({
    step: z.literal("password"),
    value: z.string().min(1, "Введите пароль двухэтапной проверки."),
  }),
])

// The bot takes the step, clears it with the input and answers in state/error (bot/bot/account.py).
export async function loginStep(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await superadmin()
  const parsed = Step.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const s = await db.settings.findUnique({ where: { id: 1 } })
  if (!s?.apiId || !s.apiHash)
    return { error: "Сначала сохраните API ID и API HASH." }
  const data = {
    step: parsed.data.step,
    input: encrypt(parsed.data.value),
    error: null,
  }
  await db.mtprotoLogin.upsert({ where: { id: 1 }, create: data, update: data })
  revalidatePath("/settings")
  return { saved: true }
}

// The bot sees the session gone and stops the user client.
// shortcut: no auth.logOut, so Telegram still lists the session until it is ended in the app's
// Settings → Devices; send a logout step to the bot if that matters.
export async function logout() {
  await superadmin()
  await db.settings.updateMany({
    data: { apiSession: null, apiAccount: null },
  })
  await db.mtprotoLogin.deleteMany()
  revalidatePath("/settings")
}
