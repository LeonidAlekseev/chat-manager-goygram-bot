"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import bcrypt from "bcryptjs"
import { z } from "zod"

import { db } from "@/lib/db"

const Name = z.string().trim().min(1).max(255)
const Password = z.string().min(8).max(72)

async function requireSuperadmin() {
  if ((await auth())?.user?.role !== "superadmin") throw new Error("Forbidden")
}

const hash = (password: string) => bcrypt.hash(password, 12)

export async function createManager(formData: FormData) {
  await requireSuperadmin()
  const { login, name, password } = z
    .object({
      login: z.string().trim().min(1).max(64),
      name: Name,
      password: Password,
    })
    .parse(Object.fromEntries(formData))
  await db.manager.create({
    data: { login, name, passwordHash: await hash(password) },
  })
  revalidatePath("/managers")
}

// Empty password keeps the current one.
export async function updateManager(formData: FormData) {
  await requireSuperadmin()
  const { id, name, password } = z
    .object({
      id: z.coerce.number().int(),
      name: Name,
      password: Password.or(z.literal("")),
    })
    .parse(Object.fromEntries(formData))
  // role filter: the env superadmin is never editable from the panel
  await db.manager.updateMany({
    where: { id, role: "manager" },
    data: { name, ...(password && { passwordHash: await hash(password) }) },
  })
  revalidatePath("/managers")
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
