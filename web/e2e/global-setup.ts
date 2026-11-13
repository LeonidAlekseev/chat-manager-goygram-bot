import { execSync } from "node:child_process"

import { PrismaClient } from "@prisma/client"

const telegramId = BigInt(-999000001)

export const CHAT = "E2E чат"

// Chats normally come from the bot; the smoke test needs one to bind.
export default async function setup() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required")
  const name = new URL(process.env.DATABASE_URL).pathname.slice(1)
  if (!/test|e2e/i.test(name) && process.env.E2E_ALLOW_ANY_DB !== "1")
    throw new Error(
      `e2e writes to the database: "${name}" has no "test"/"e2e" in its name. Use a disposable DB or set E2E_ALLOW_ANY_DB=1.`
    )
  execSync("pnpm exec prisma migrate deploy", { stdio: "inherit" })
  const db = new PrismaClient()
  await db.chat.upsert({
    where: { telegramId },
    create: { telegramId, title: CHAT },
    update: { title: CHAT, active: true },
  })
  await db.$disconnect()
}
