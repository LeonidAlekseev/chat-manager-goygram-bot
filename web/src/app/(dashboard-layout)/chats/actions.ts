"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { Prisma } from "@prisma/client"
import { z } from "zod"

import { duplicated, getViewer, isSuper, visibleChats } from "@/lib/access"
import { db } from "@/lib/db"

// Postgres INT: a larger id can never exist
const Id = z
  .string()
  .regex(/^\d+$/)
  .refine((v) => +v >= 1 && +v <= 2147483647)
  .transform(Number)

const EXPIRED = { error: "Сессия истекла, войдите заново" }
const NOT_FOUND = { error: "Чат не найден — обновите страницу" }

const RenameSchema = z.object({
  id: Id,
  title: z.string().trim().min(1).max(255),
})

export async function renameChat(
  formData: FormData
): Promise<{ error?: string }> {
  const v = await getViewer()
  if (!v) return EXPIRED
  if (duplicated(formData, "id")) return NOT_FOUND
  const parsed = RenameSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success)
    return {
      error: parsed.error.issues.some((i) => i.path[0] === "id")
        ? "Чат не найден — обновите страницу"
        : "Название — от 1 до 255 символов",
    }
  const { id, title } = parsed.data
  const { count } = await db.chat.updateMany({
    where: { id, ...visibleChats(v) },
    data: { title },
  })
  if (!count) return NOT_FOUND
  revalidatePath("/chats")
  return {}
}

// The panel never calls Telegram: the bot sees `deleting`, leaves the group and deletes the row.
// Unbinding the schedule stops scheduled sends right away; queued jobs go with the row.
export async function deleteChat(
  formData: FormData
): Promise<{ error?: string }> {
  const v = await getViewer()
  if (!v) return EXPIRED
  if (!isSuper(v)) return { error: "Удалять чаты может только суперадмин" }
  if (duplicated(formData, "id")) return NOT_FOUND
  const id = Id.safeParse(formData.get("id"))
  const { count } = id.success
    ? await db.chat.updateMany({
        where: { id: id.data },
        data: { deleting: true, scheduleId: null },
      })
    : { count: 0 }
  if (!count) return NOT_FOUND
  revalidatePath("/chats")
  redirect("/chats")
}

// The superadmin assigns the chat's managers: the checked ones replace the old set.
export async function assignManagers(
  formData: FormData
): Promise<{ error?: string }> {
  const v = await getViewer()
  if (!v) return EXPIRED
  if (!isSuper(v))
    return { error: "Назначать менеджеров может только суперадмин" }
  if (duplicated(formData, "id")) return NOT_FOUND
  const id = Id.safeParse(formData.get("id"))
  const managerIds = formData.getAll("managerId").map((m) => Id.safeParse(m))
  if (!id.success || managerIds.some((m) => !m.success)) return NOT_FOUND
  const ids = managerIds.map((m) => m.data!)
  try {
    await db.$transaction([
      db.chatManager.deleteMany({ where: { chatId: id.data } }),
      db.chatManager.createMany({
        data: ids.map((managerId) => ({ chatId: id.data, managerId })),
        skipDuplicates: true,
      }),
      // a manager taken off the chat takes their schedule with them; the superadmin's stays
      db.chat.updateMany({
        where: {
          id: id.data,
          schedule: { author: { role: "manager", id: { notIn: ids } } },
        },
        data: { scheduleId: null },
      }),
    ])
  } catch (e) {
    // P2003: the chat or a manager is gone
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003")
      return NOT_FOUND
    throw e
  }
  revalidatePath("/chats", "layout")
  return {}
}

// «Найти группы бота» (#94): the bot runs the scan through the MTProto account and writes the result.
// A scan already queued or running is left alone, a finished one makes way for a new one.
export async function discoverChats(): Promise<{ error?: string }> {
  const v = await getViewer()
  if (!v) return EXPIRED
  if (!isSuper(v)) return { error: "Искать группы может только суперадмин" }
  const s = await db.settings.findUnique({
    where: { id: 1 },
    select: { apiSession: true },
  })
  if (!s?.apiSession)
    return {
      error:
        "Аккаунт Telegram не подключён: войдите в него в Настройках, поиск групп идёт через него.",
    }
  await db.$executeRaw`
    INSERT INTO chat_discovery (id, state) VALUES (1, 'queued')
    ON CONFLICT (id) DO UPDATE SET state = 'queued', found = NULL, added = NULL, error = NULL, updated_at = now()
    WHERE chat_discovery.state = 'done'`
  revalidatePath("/chats")
  return {}
}
