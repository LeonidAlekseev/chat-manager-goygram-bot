"use server"

import { randomBytes } from "node:crypto"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"

import { db } from "@/lib/db"

const TTL_MS = 15 * 60_000

// The session carries the login only; it is the manager's own account, never an id from the form.
async function currentLogin() {
  const login = (await auth())?.user?.name
  if (!login) throw new Error("Unauthorized")
  return login
}

export async function createLinkCode(
  _prev: unknown,
  _formData: FormData
): Promise<{ command: string }> {
  const code = randomBytes(16).toString("base64url")
  await db.manager.update({
    where: { login: await currentLogin() },
    data: { linkCode: code, linkCodeExpiresAt: new Date(Date.now() + TTL_MS) },
  })
  revalidatePath("/profile")
  return { command: `/start link_${code}` }
}

export async function unlinkTelegram() {
  await db.manager.update({
    where: { login: await currentLogin() },
    data: { telegramUserId: null, linkCode: null, linkCodeExpiresAt: null },
  })
  revalidatePath("/profile")
}
