"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  duplicated,
  getViewer,
  visibleChats,
  visibleTemplates,
} from "@/lib/access"
import { db } from "@/lib/db"

export type ActionState = { error?: string } | null

const Schema = z
  .object({
    templateId: z.coerce.number().int().optional(),
    text: z
      .string()
      .trim()
      .max(4096)
      .transform((v) => v || undefined) // spaces only = no text, so the template check applies
      .optional(),
    mentionAll: z.preprocess((v) => v === "on", z.boolean()),
    chatIds: z.array(z.coerce.number().int()).min(1, "Выберите чаты"),
  })
  .refine((v) => v.templateId || v.text, "Выберите шаблон или введите текст")
  .refine(
    (v) => !(v.templateId && v.text),
    "Выберите что-то одно: шаблон или свой текст"
  )

export async function sendNow(
  _prev: ActionState,
  formData: FormData
): Promise<{ error?: string }> {
  const v = await getViewer()
  if (!v) throw new Error("Unauthorized")
  if (duplicated(formData, "templateId", "text", "mentionAll"))
    return { error: "Чат или шаблон не найден — обновите страницу" }
  const parsed = Schema.safeParse({
    templateId: formData.get("templateId") || undefined,
    text: formData.get("text") || undefined,
    mentionAll: formData.get("mentionAll"),
    chatIds: formData.getAll("chatIds"),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { templateId, text, mentionAll, chatIds } = parsed.data
  // unknown or deactivated chats / a missing template would otherwise fail on the FK or send to a dead chat
  const [live, tpl] = await Promise.all([
    db.chat.count({
      where: {
        id: { in: chatIds },
        active: true,
        deleting: false,
        ...visibleChats(v),
      },
    }),
    templateId
      ? db.template.count({ where: { id: templateId, ...visibleTemplates(v) } })
      : 1,
  ])
  if (live !== new Set(chatIds).size || !tpl)
    return { error: "Чат или шаблон не найден — обновите страницу" }
  await db.outbox.createMany({
    data: chatIds.map((chatId) => ({
      chatId,
      templateId,
      text,
      mentionAll: !!text && mentionAll, // a template's own setting applies
    })),
  })
  revalidatePath("/send")
  return {}
}
