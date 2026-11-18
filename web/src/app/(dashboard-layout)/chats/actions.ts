"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { Prisma } from "@prisma/client"
import { z } from "zod"

import { db } from "@/lib/db"

// Postgres INT: a larger id can never exist
const Id = z
  .string()
  .regex(/^\d+$/)
  .refine((v) => +v >= 1 && +v <= 2147483647)
  .transform(Number)

const RenameSchema = z.object({
  id: Id,
  title: z.string().trim().min(1).max(255),
})

export async function renameChat(
  formData: FormData
): Promise<{ error?: string }> {
  if (!(await auth())?.user) return { error: "Сессия истекла, войдите заново" }
  const parsed = RenameSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success)
    return {
      error: parsed.error.issues.some((i) => i.path[0] === "id")
        ? "Чат не найден — обновите страницу"
        : "Название — от 1 до 255 символов",
    }
  const { id, title } = parsed.data
  try {
    await db.chat.update({ where: { id }, data: { title } })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025")
      return { error: "Чат не найден — обновите страницу" }
    throw e
  }
  revalidatePath("/chats")
  return {}
}

// The panel never calls Telegram: the bot sees `deleting`, leaves the group and deletes the row.
// Unbinding the schedule stops scheduled sends right away; queued jobs go with the row.
export async function deleteChat(
  formData: FormData
): Promise<{ error?: string }> {
  if (!(await auth())?.user) return { error: "Сессия истекла, войдите заново" }
  const id = Id.safeParse(formData.get("id"))
  const { count } = id.success
    ? await db.chat.updateMany({
        where: { id: id.data },
        data: { deleting: true, scheduleId: null },
      })
    : { count: 0 }
  if (!count) return { error: "Чат не найден — обновите страницу" }
  revalidatePath("/chats")
  redirect("/chats")
}
