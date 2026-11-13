"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { z } from "zod"

import { db } from "@/lib/db"

const RenameSchema = z.object({
  id: z.coerce.number().int(),
  title: z.string().trim().min(1).max(255),
})

export async function renameChat(formData: FormData) {
  if (!(await auth())) throw new Error("Unauthorized")
  const { id, title } = RenameSchema.parse(Object.fromEntries(formData))
  await db.chat.update({ where: { id }, data: { title } })
  revalidatePath("/chats")
}
