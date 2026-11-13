import bcrypt from "bcryptjs"

import { db } from "@/lib/db"

export type SessionUser = {
  id: number
  login: string
  role: "superadmin" | "manager"
}

/** Create the env superadmin, or refresh its password hash if the env changed. Runs on server start. */
export async function ensureSuperadmin(
  env: Record<string, string | undefined> = process.env
) {
  const login = env.SUPERADMIN_LOGIN
  const password = env.SUPERADMIN_PASSWORD
  if (!login || !password)
    throw new Error("SUPERADMIN_LOGIN and SUPERADMIN_PASSWORD must be set")
  const passwordHash = await bcrypt.hash(password, 12)
  await db.manager.upsert({
    where: { login },
    create: { login, passwordHash, role: "superadmin" },
    update: { passwordHash, role: "superadmin" },
  })
}

export async function verifyCredentials(
  login: string,
  password: string
): Promise<SessionUser | null> {
  const m = await db.manager.findUnique({ where: { login } })
  if (!m?.active || !(await bcrypt.compare(password, m.passwordHash)))
    return null
  return { id: m.id, login: m.login, role: m.role }
}

/** Fresh DB check for a JWT session: null when the manager is gone or disabled. */
export async function activeSessionUser(
  id: number
): Promise<SessionUser | null> {
  const m = await db.manager.findUnique({ where: { id } })
  return m?.active ? { id: m.id, login: m.login, role: m.role } : null
}
