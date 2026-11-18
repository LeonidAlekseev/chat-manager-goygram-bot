"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { Prisma } from "@prisma/client"
import { z } from "zod"

import { db } from "@/lib/db"

// Postgres INT: a larger id can never exist
const IdSchema = z.coerce.number().int().min(1).max(2147483647)

const RenameSchema = z.object({
  id: IdSchema,
  title: z.string().trim().min(1).max(255),
})

export async function renameChat(
  formData: FormData
): Promise<{ error?: string }> {
  if (!(await auth())) throw new Error("Unauthorized")
  const fields = Object.fromEntries(formData)
  if (!IdSchema.safeParse(fields.id).success)
    return { error: "Чат не найден — обновите страницу" }
  const { id, title } = RenameSchema.parse(fields)
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
