"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { z } from "zod"

import { db } from "@/lib/db"

export type ActionState = { error?: string } | null

const Schema = z
  .object({
    templateId: z.coerce.number().int().optional(),
    text: z.string().trim().max(4096).optional(),
    chatIds: z.array(z.coerce.number().int()).min(1, "Выберите чаты"),
  })
  .refine(
    (v) => !!v.templateId !== !!v.text,
    "Выберите шаблон или введите текст"
  )

export async function sendNow(
  _prev: ActionState,
  formData: FormData
): Promise<{ error?: string }> {
  if (!(await auth())?.user) throw new Error("Unauthorized")
  const parsed = Schema.safeParse({
    templateId: formData.get("templateId") || undefined,
    text: formData.get("text") || undefined,
    chatIds: formData.getAll("chatIds"),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { templateId, text, chatIds } = parsed.data
  // unknown or deactivated chats / a missing template would otherwise fail on the FK or send to a dead chat
  const [live, tpl] = await Promise.all([
    db.chat.count({ where: { id: { in: chatIds }, active: true } }),
    templateId ? db.template.count({ where: { id: templateId } }) : 1,
  ])
  if (live !== new Set(chatIds).size || !tpl)
    return { error: "Чат или шаблон не найден — обновите страницу" }
  await db.outbox.createMany({
    data: chatIds.map((chatId) => ({ chatId, templateId, text })),
  })
  revalidatePath("/send")
  return {}
}
