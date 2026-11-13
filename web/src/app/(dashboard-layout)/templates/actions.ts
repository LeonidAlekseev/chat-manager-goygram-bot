"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { z } from "zod"

import { db } from "@/lib/db"

export type ActionState = { error?: string } | null

const flag = z.preprocess((v) => v === "on", z.boolean())
const base = {
  id: z.coerce.number().int().optional(),
  name: z.string().trim().min(1).max(255),
  multiple: flag,
  anonymous: flag,
  mentionAll: flag,
}
// Telegram limits: poll question 1-300, 2-10 options of 1-100 chars, message 1-4096.
const Schema = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    kind: z.literal("poll"),
    text: z.string().trim().min(1).max(300),
    options: z
      .array(z.string().trim().min(1).max(100))
      .min(2, "Нужно минимум 2 варианта")
      .max(10, "Не больше 10 вариантов"),
  }),
  z.object({
    ...base,
    kind: z.literal("text"),
    text: z.string().trim().min(1).max(4096),
  }),
])

async function requireAuth() {
  if (!(await auth())) throw new Error("Unauthorized")
}

export async function saveTemplate(
  _prev: ActionState,
  formData: FormData
): Promise<{ error?: string }> {
  await requireAuth()
  const raw = {
    ...Object.fromEntries(formData),
    // one option per line; blank lines ignored
    options: String(formData.get("options") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  }
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { id, ...rest } = parsed.data
  const data = { ...rest, options: rest.kind === "poll" ? rest.options : [] }
  if (id) await db.template.update({ where: { id }, data })
  else await db.template.create({ data })
  revalidatePath("/templates")
  return {}
}

export async function deleteTemplate(
  _prev: ActionState,
  formData: FormData
): Promise<{ error?: string }> {
  await requireAuth()
  const id = z.coerce.number().int().parse(formData.get("id"))
  if (await db.scheduleItem.count({ where: { templateId: id } }))
    return {
      error: "Шаблон используется в расписании — сначала уберите его оттуда.",
    }
  await db.template.delete({ where: { id } })
  revalidatePath("/templates")
  return {}
}
