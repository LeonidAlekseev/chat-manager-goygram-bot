"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  NOT_FOUND,
  duplicated,
  getViewer,
  isSuper,
  visibleChats,
  visibleSends,
  visibleTemplates,
} from "@/lib/access"
import { db } from "@/lib/db"
import { TIMEZONE, nowInZone, zonedToUtc } from "@/lib/timezone"

export type ActionState = { error?: string } | null

const flag = z.preprocess((v) => v === "on", z.boolean())
// spaces only = not given, so the "choose one" check applies
const given = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || undefined)
    .optional()

// Telegram limits as for templates: message 4096, poll question 300, 2-10 options of 1-100 chars.
const Schema = z
  .object({
    templateId: z.coerce.number().int().optional(),
    text: given(4096),
    question: given(300),
    options: z.array(z.string().max(100, "Вариант — до 100 символов")),
    anonymous: flag,
    multiple: flag,
    mentionAll: flag,
    sendAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Укажите дату и время")
      .refine((v) => !isNaN(Date.parse(`${v}Z`)), "Укажите дату и время")
      .optional(),
    chatIds: z.array(z.coerce.number().int()).min(1, "Выберите чаты"),
  })
  .refine(
    (v) => v.templateId || v.text || v.question,
    "Выберите шаблон, введите текст или вопрос опроса"
  )
  .refine(
    (v) => [v.templateId, v.text, v.question].filter(Boolean).length === 1,
    "Выберите что-то одно: шаблон, свой текст или свой опрос"
  )
  .refine(
    (v) => !v.question || v.options.length >= 2,
    "Нужно минимум 2 варианта"
  )
  .refine(
    (v) => !v.question || v.options.length <= 10,
    "Не больше 10 вариантов"
  )

export async function sendNow(
  _prev: ActionState,
  formData: FormData
): Promise<{ error?: string }> {
  const v = await getViewer()
  if (!v) throw new Error("Unauthorized")
  const single = ["templateId", "text", "question", "options", "sendAt"]
  if (duplicated(formData, ...single, "mentionAll", "anonymous", "multiple"))
    return { error: "Чат или шаблон не найден — обновите страницу" }
  const parsed = Schema.safeParse({
    templateId: formData.get("templateId") || undefined,
    text: formData.get("text") || undefined,
    question: formData.get("question") || undefined,
    // one option per line, blank lines ignored (as in a template)
    options: String(formData.get("options") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    anonymous: formData.get("anonymous"),
    multiple: formData.get("multiple"),
    mentionAll: formData.get("mentionAll"),
    sendAt: formData.get("sendAt") || undefined,
    chatIds: formData.getAll("chatIds"),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { templateId, question, sendAt, chatIds, ...p } = parsed.data
  if (sendAt && sendAt.replace("T", " ") <= nowInZone())
    return {
      error: `Время отправки уже прошло (${TIMEZONE}) — укажите будущее`,
    }
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
  const own = !templateId // a template's own content and settings apply
  await db.outbox.createMany({
    data: chatIds.map((chatId) => ({
      chatId,
      templateId,
      text: p.text ?? question, // a custom poll's question; the bot sees options and sends a poll
      options: question ? p.options : [],
      anonymous: !!question && p.anonymous,
      multiple: !!question && p.multiple,
      mentionAll: own && p.mentionAll,
      sendAt: sendAt && zonedToUtc(sendAt),
      authorId: v.id,
    })),
  })
  revalidatePath("/send")
  return {}
}

// A scheduled job can be cancelled until it is due and claimed, by its author or the superadmin.
export async function cancelSend(
  formData: FormData
): Promise<{ error?: string }> {
  const v = await getViewer()
  if (!v) throw new Error("Unauthorized")
  if (duplicated(formData, "id")) return { error: NOT_FOUND }
  const id = z.coerce.number().int().safeParse(formData.get("id"))
  if (!id.success) return { error: NOT_FOUND }
  // one statement: the bot claims only due jobs (send_at <= now) by inserting their log row
  const { count } = await db.outbox.deleteMany({
    where: {
      id: id.data,
      sendAt: { gt: new Date() },
      sendLog: null,
      AND: [visibleSends(v), isSuper(v) ? {} : { authorId: v.id }],
    },
  })
  if (!count)
    return {
      error: "Задание уже отправляется или не найдено — обновите страницу",
    }
  revalidatePath("/send")
  return {}
}
