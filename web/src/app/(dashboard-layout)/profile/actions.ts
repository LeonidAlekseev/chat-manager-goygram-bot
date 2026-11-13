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
): Promise<{ command: string; url: string | null }> {
  const code = randomBytes(16).toString("base64url")
  await db.manager.update({
    where: { login: await currentLogin() },
    data: { linkCode: code, linkCodeExpiresAt: new Date(Date.now() + TTL_MS) },
  })
  revalidatePath("/profile")
  const bot = (await db.settings.findUnique({ where: { id: 1 } }))?.botUsername
  return {
    command: `/start link_${code}`,
    url: bot ? `https://t.me/${bot}?start=link_${code}` : null,
  }
}

export async function unlinkTelegram() {
  await db.manager.update({
    where: { login: await currentLogin() },
    data: { telegramUserId: null, linkCode: null, linkCodeExpiresAt: null },
  })
  revalidatePath("/profile")
}
