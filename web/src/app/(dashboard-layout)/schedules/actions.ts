"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { Prisma } from "@prisma/client"
import { z } from "zod"

import { db } from "@/lib/db"
import { TIMEZONE, nowInZone } from "@/lib/timezone"

export type ActionState = { error?: string } | null

const PERIODS = ["none", "day", "week", "twoweek", "month"] as const

// Postgres INT: a larger id can never exist, and Prisma would throw on it
const BAD_ID = "Не найдено — обновите страницу"
const Id = z
  .string()
  .regex(/^\d+$/, BAD_ID)
  .refine((v) => +v >= 1 && +v <= 2147483647, BAD_ID)
  .transform(Number)
const NOT_FOUND = { error: BAD_ID }
const EXPIRED = { error: "Сессия истекла, войдите заново" }

// P2025: the row is gone; P2003: the other side of a link is gone
function gone(e: unknown) {
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    (e.code === "P2025" || e.code === "P2003")
  )
    return NOT_FOUND
  throw e
}

const Item = z.object({
  id: Id.optional(), // absent for a new row
  templateId: Id,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время — ЧЧ:ММ"),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата старта — ГГГГ-ММ-ДД")
    .transform((d) => new Date(`${d}T00:00:00Z`)),
  period: z.enum(PERIODS, { message: "Неизвестный период" }),
})

const Schema = z.object({
  id: Id.optional(),
  name: z
    .string()
    .trim()
    .min(1, "Введите название")
    .max(255, "Название — до 255 символов"),
  // set when saving from a chat page: "this" edits only that chat's copy
  chatId: Id.optional(),
  scope: z.enum(["all", "this"]).optional(),
  items: z.array(Item),
})

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
    if (e.code === "P2003" || e.code === "P2025")
      return {
        error: "Шаблон, чат или расписание уже удалены — обновите страницу.",
      }
  }
  throw e
}

export async function saveSchedule(
  _prev: ActionState,
  formData: FormData
): Promise<{ error?: string }> {
  if (!(await auth())?.user) return EXPIRED
  const col = (k: string) => formData.getAll(k).map(String)
  const times = col("time")
  const itemIds = col("itemId")
  const parsed = Schema.safeParse({
    ...Object.fromEntries(
      ["id", "name", "chatId", "scope"]
        .filter((k) => formData.get(k))
        .map((k) => [k, formData.get(k)])
    ),
    items: col("templateId").map((templateId, i) => ({
      id: itemIds[i] || undefined,
      templateId,
      time: times[i],
      startDate: col("startDate")[i],
      period: col("period")[i],
    })),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { id, name, chatId, scope, items } = parsed.data

  // a one-time item in the past is refused, unless it is saved unchanged (it may have fired already)
  const saved = id
    ? await db.scheduleItem.findMany({
        where: {
          scheduleId: id, // another schedule's item id must not count as "unchanged"
          id: { in: items.flatMap((i) => (i.id ? [i.id] : [])) },
        },
      })
    : []
  const now = nowInZone()
  const stale = items.find((i) => {
    const day = i.startDate.toISOString().slice(0, 10)
    const old = saved.find((o) => o.id === i.id)
    return (
      i.period === "none" &&
      `${day} ${i.time}` < now &&
      !(
        old?.period === "none" &&
        old.time === i.time &&
        old.startDate.getTime() === i.startDate.getTime()
      )
    )
  })
  if (stale)
    return {
      error: `«Один раз» в прошлом: дата и время (${TIMEZONE}) уже прошли`,
    }

  try {
    await db.$transaction(async (tx) => {
      if (!id) {
        await tx.schedule.create({
          data: {
            name,
            items: { create: items.map((i) => ({ ...i, id: undefined })) },
          },
        })
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
          tx.schedule.findUniqueOrThrow({
            where: { id },
            include: { items: { select: { id: true } } },
          }),
          tx.chat.findUniqueOrThrow({ where: { id: chatId } }),
        ])
        // an unchanged name gets the chat's title, plus a number if that is taken too
        let copyName = name
        if (name === orig.name) {
          copyName = `${name} (${chat.title})`
          for (
            let n = 2;
            await tx.schedule.count({ where: { name: copyName } });
            n++
          )
            copyName = `${name} (${chat.title}) ${n}`
        }
        const copy = await tx.schedule.create({ data: { name: copyName } })
        const origIds = new Set(orig.items.map((i) => i.id))
        for (const { id: oldId, ...data } of items) {
          const { id: newId } = await tx.scheduleItem.create({
            data: { ...data, scheduleId: copy.id },
          })
          // the chat's claims follow its item, so a save in the firing minute does not resend
          if (oldId && origIds.has(oldId))
            await tx.sendLog.updateMany({
              where: { chatId, scheduleItemId: oldId },
              data: { scheduleItemId: newId },
            })
        }
        await tx.chat.update({
          where: { id: chatId },
          data: { scheduleId: copy.id },
        })
        return
      }
      // Items keep their ids, so the bot's (chat, item, slot) claim survives a save in the firing minute.
      await tx.schedule.update({ where: { id }, data: { name } })
      await tx.scheduleItem.deleteMany({
        where: {
          scheduleId: id,
          id: { notIn: items.flatMap((i) => (i.id ? [i.id] : [])) },
        },
      })
      // park kept items on unique times first, so items can swap times without a unique clash
      for (const { id: itemId } of items)
        if (itemId)
          await tx.scheduleItem.updateMany({
            where: { id: itemId, scheduleId: id },
            data: { time: `~${itemId}` },
          })
      for (const { id: itemId, ...data } of items)
        if (itemId)
          await tx.scheduleItem.updateMany({
            where: { id: itemId, scheduleId: id },
            data,
          })
        else await tx.scheduleItem.create({ data: { ...data, scheduleId: id } })
    })
  } catch (e) {
    return friendly(e)
  }
  revalidate()
  return {}
}

export async function bindChats(
  formData: FormData
): Promise<{ error?: string }> {
  if (!(await auth())?.user) return EXPIRED
  const id = Id.safeParse(formData.get("id"))
  const chatIds = formData.getAll("chatId").map((c) => Id.safeParse(c))
  if (!id.success || chatIds.some((c) => !c.success)) return NOT_FOUND
  const ids = chatIds.map((c) => c.data!)
  try {
    await db.$transaction([
      db.chat.updateMany({
        where: { scheduleId: id.data, id: { notIn: ids } },
        data: { scheduleId: null },
      }),
      db.chat.updateMany({
        where: { id: { in: ids }, deleting: false },
        data: { scheduleId: id.data },
      }),
    ])
  } catch (e) {
    return gone(e)
  }
  revalidate()
  return {}
}

export async function bindChat(
  formData: FormData
): Promise<{ error?: string }> {
  if (!(await auth())?.user) return EXPIRED
  const chatId = Id.safeParse(formData.get("chatId"))
  const raw = formData.get("scheduleId")
  const scheduleId = raw ? Id.safeParse(raw) : null
  if (!chatId.success || (scheduleId && !scheduleId.success)) return NOT_FOUND
  try {
    await db.chat.update({
      where: { id: chatId.data },
      data: { scheduleId: scheduleId?.data ?? null },
    })
  } catch (e) {
    return gone(e)
  }
  revalidate()
  return {}
}

export async function deleteSchedule(
  formData: FormData
): Promise<{ error?: string }> {
  if (!(await auth())?.user) return EXPIRED
  const id = Id.safeParse(formData.get("id"))
  if (!id.success) return NOT_FOUND
  try {
    await db.schedule.delete({ where: { id: id.data } })
  } catch (e) {
    return gone(e)
  }
  revalidate()
  return {}
}
