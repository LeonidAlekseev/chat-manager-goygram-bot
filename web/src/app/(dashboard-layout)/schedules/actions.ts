"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { Prisma } from "@prisma/client"
import { z } from "zod"

import { db } from "@/lib/db"

export type ActionState = { error?: string } | null

const PERIODS = ["none", "day", "week", "twoweek", "month"] as const

const Item = z.object({
  templateId: z.coerce.number().int(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время — ЧЧ:ММ"),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата старта — ГГГГ-ММ-ДД")
    .transform((d) => new Date(`${d}T00:00:00Z`)),
  period: z.enum(PERIODS, { message: "Неизвестный период" }),
})

const Schema = z.object({
  id: z.coerce.number().int().optional(),
  name: z.string().trim().min(1).max(255),
  // set when saving from a chat page: "this" edits only that chat's copy
  chatId: z.coerce.number().int().optional(),
  scope: z.enum(["all", "this"]).optional(),
  items: z.array(Item),
})

const Id = z.coerce.number().int()

async function requireAuth() {
  if (!(await auth())) throw new Error("Unauthorized")
}

function revalidate() {
  revalidatePath("/schedules")
  revalidatePath("/chats", "layout")
}

function friendly(e: unknown): { error: string } {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002")
      return {
        error:
          "Такое уже есть: название расписания или пункт с тем же шаблоном и временем.",
      }
    if (e.code === "P2003") return { error: "Шаблон или чат уже удалён." }
  }
  throw e
}

export async function saveSchedule(
  _prev: ActionState,
  formData: FormData
): Promise<{ error?: string }> {
  await requireAuth()
  const col = (k: string) => formData.getAll(k).map(String)
  const times = col("time")
  const parsed = Schema.safeParse({
    ...Object.fromEntries(
      ["id", "name", "chatId", "scope"]
        .filter((k) => formData.get(k))
        .map((k) => [k, formData.get(k)])
    ),
    items: col("templateId").map((templateId, i) => ({
      templateId,
      time: times[i],
      startDate: col("startDate")[i],
      period: col("period")[i],
    })),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { id, name, chatId, scope, items } = parsed.data

  try {
    await db.$transaction(async (tx) => {
      if (!id) {
        await tx.schedule.create({ data: { name, items: { create: items } } })
        return
      }
      const others = chatId
        ? await tx.chat.count({
            where: { scheduleId: id, id: { not: chatId } },
          })
        : 0
      if (scope === "this" && others > 0) {
        // copy-on-write: this chat gets its own edited copy, the others keep the original
        const [orig, chat] = await Promise.all([
          tx.schedule.findUniqueOrThrow({ where: { id } }),
          tx.chat.findUniqueOrThrow({ where: { id: chatId } }),
        ])
        const copy = await tx.schedule.create({
          data: {
            name: name === orig.name ? `${name} (${chat.title})` : name,
            items: { create: items },
          },
        })
        await tx.chat.update({
          where: { id: chatId },
          data: { scheduleId: copy.id },
        })
        return
      }
      // shortcut: items are replaced, so their send-log links go null and a save in the very
      // minute an item fired could fire it again; upgrade to per-item upserts if that bites.
      await tx.schedule.update({
        where: { id },
        data: { name, items: { deleteMany: {}, create: items } },
      })
    })
  } catch (e) {
    return friendly(e)
  }
  revalidate()
  return {}
}

export async function bindChats(formData: FormData) {
  await requireAuth()
  const id = Id.parse(formData.get("id"))
  const chatIds = formData.getAll("chatId").map((c) => Id.parse(c))
  await db.$transaction([
    db.chat.updateMany({
      where: { scheduleId: id, id: { notIn: chatIds } },
      data: { scheduleId: null },
    }),
    db.chat.updateMany({
      where: { id: { in: chatIds } },
      data: { scheduleId: id },
    }),
  ])
  revalidate()
}

export async function bindChat(formData: FormData) {
  await requireAuth()
  const chatId = Id.parse(formData.get("chatId"))
  const raw = formData.get("scheduleId")
  await db.chat.update({
    where: { id: chatId },
    data: { scheduleId: raw ? Id.parse(raw) : null },
  })
  revalidate()
}

export async function deleteSchedule(formData: FormData) {
  await requireAuth()
  await db.schedule.delete({ where: { id: Id.parse(formData.get("id")) } })
  revalidate()
}
