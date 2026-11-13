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
