"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { z } from "zod"

import { db } from "@/lib/db"

export type ActionState = { error?: string } | null

const Schema = z
  .object({
    templateId: z.coerce.number().int().optional(),
    text: z.string().trim().max(4096).optional(),
    chatIds: z.array(z.coerce.number().int()).min(1, "Выберите чаты"),
  })
  .refine(
    (v) => !!v.templateId !== !!v.text,
    "Выберите шаблон или введите текст"
  )

export async function sendNow(
  _prev: ActionState,
  formData: FormData
): Promise<{ error?: string }> {
  if (!(await auth())) throw new Error("Unauthorized")
  const parsed = Schema.safeParse({
    templateId: formData.get("templateId") || undefined,
    text: formData.get("text") || undefined,
    chatIds: formData.getAll("chatIds"),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { templateId, text, chatIds } = parsed.data
  await db.outbox.createMany({
    data: chatIds.map((chatId) => ({ chatId, templateId, text })),
  })
  revalidatePath("/send")
  return {}
}
