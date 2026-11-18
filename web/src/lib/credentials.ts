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
  if (Buffer.byteLength(password) > 72)
    throw new Error(
      "SUPERADMIN_PASSWORD must be at most 72 bytes (bcrypt limit)"
    )
  const passwordHash = await bcrypt.hash(password, 12)
  await db.manager.upsert({
    where: { login },
    create: { login, passwordHash, role: "superadmin" },
    update: { passwordHash, role: "superadmin", active: true },
  })
  // A superadmin from a previous SUPERADMIN_LOGIN must not stay able to sign in.
  await db.manager.updateMany({
    where: { role: "superadmin", login: { not: login } },
    data: { active: false },
  })
}

// Valid bcrypt hash of a random string: compared when the login is unknown so timing does not reveal it.
const DUMMY_HASH =
  "$2b$12$iZIwL4.zo/9bRDpavaGkS.ys.33bBAO3ztEplKX/oQdlQsq5m4BqS"

export async function verifyCredentials(
  login: string,
  password: string
): Promise<SessionUser | null> {
  const m = await db.manager.findUnique({ where: { login } })
  const ok = await bcrypt.compare(password, m?.passwordHash ?? DUMMY_HASH)
  if (!m?.active || !ok) return null
  return { id: m.id, login: m.login, role: m.role }
}

/** Fresh DB check for a JWT session: null when the manager is gone or disabled. */
export async function activeSessionUser(
  id: number
): Promise<SessionUser | null> {
  const m = await db.manager.findUnique({ where: { id } })
  return m?.active ? { id: m.id, login: m.login, role: m.role } : null
}
