"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { Prisma } from "@prisma/client"
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
const Schema = z.discriminatedUnion(
  "kind",
  [
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
  ],
  { error: "Неизвестный тип шаблона" }
)

async function requireAuth() {
  if (!(await auth())?.user) throw new Error("Unauthorized")
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
  const editing = z.coerce.number().int().safeParse(formData.get("id"))
  const current = editing.success
    ? await db.template.findUnique({ where: { id: editing.data } })
    : null
  // a copy's content lives in Telegram: only its name and mention-all can change here
  if (editing.success && current?.kind === "copy") {
    const c = z.object({ name: base.name, mentionAll: flag }).safeParse(raw)
    if (!c.success) return { error: c.error.issues[0].message }
    await db.template.update({ where: { id: editing.data }, data: c.data })
    revalidatePath("/templates")
    return {}
  }
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { id, ...rest } = parsed.data
  // a quiz's correct answer is an option index: its options and mode stay as Telegram sent them
  if (
    current?.correctOptionId != null &&
    (rest.kind !== "poll" ||
      rest.multiple !== current.multiple ||
      rest.options.join("\n") !== current.options.join("\n"))
  )
    return {
      error:
        "Варианты, тип и «Несколько ответов» викторины не меняются — перешлите викторину боту заново",
    }
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
  try {
    // the FK (ON DELETE RESTRICT) is the check, so an item added meanwhile can't slip through
    await db.template.delete({ where: { id } })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003")
      return {
        error: "Шаблон используется в расписании — сначала уберите его оттуда.",
      }
    throw e
  }
  revalidatePath("/templates")
  return {}
}
