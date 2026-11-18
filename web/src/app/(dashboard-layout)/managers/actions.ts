"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { Prisma } from "@prisma/client"
import bcrypt from "bcryptjs"
import { z } from "zod"

import { db } from "@/lib/db"

const Name = z.string().trim().min(1).max(255)
// bcrypt reads only 72 bytes, so the limit is in bytes (Cyrillic is 2 bytes per char)
const Password = z
  .string()
  .min(8)
  .refine((p) => Buffer.byteLength(p) <= 72)

async function requireSuperadmin() {
  if ((await auth())?.user?.role !== "superadmin") throw new Error("Forbidden")
}

const hash = (password: string) => bcrypt.hash(password, 12)

export type ActionState = { error?: string } | null

const NewManager = z.object({
  login: z.string().trim().min(1).max(64),
  name: Name,
  password: Password,
})
const INVALID =
  "Пароль — от 8 символов, не более 72 байт, логин — до 64, имя — до 255; все поля обязательны."

export async function createManager(
  _prev: ActionState,
  formData: FormData
): Promise<{ error?: string }> {
  await requireSuperadmin()
  const parsed = NewManager.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: INVALID }
  const { login, name, password } = parsed.data
  try {
    await db.manager.create({
      data: { login, name, passwordHash: await hash(password) },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { error: "Этот логин уже занят." }
    throw e
  }
  revalidatePath("/managers")
  return {}
}

// Empty password keeps the current one.
export async function updateManager(
  _prev: ActionState,
  formData: FormData
): Promise<{ error?: string }> {
  await requireSuperadmin()
  const parsed = z
    .object({
      id: z.coerce.number().int(),
      name: Name,
      password: Password.or(z.literal("")),
    })
    .safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: INVALID }
  const { id, name, password } = parsed.data
  // role filter: the env superadmin is never editable from the panel
  await db.manager.updateMany({
    where: { id, role: "manager" },
    data: { name, ...(password && { passwordHash: await hash(password) }) },
  })
  revalidatePath("/managers")
  return {}
}

export async function setManagerActive(formData: FormData) {
  await requireSuperadmin()
  const { id, active } = z
    .object({ id: z.coerce.number().int(), active: z.enum(["true", "false"]) })
    .parse(Object.fromEntries(formData))
  await db.manager.updateMany({
    where: { id, role: "manager" },
    data: { active: active === "true" },
  })
  revalidatePath("/managers")
}
