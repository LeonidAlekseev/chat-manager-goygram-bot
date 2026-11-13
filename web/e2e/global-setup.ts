import { execSync } from "node:child_process"

import { PrismaClient } from "@prisma/client"

const telegramId = BigInt(-999000001)

export const CHAT = "E2E чат"

// Chats normally come from the bot; the smoke test needs one to bind.
export default async function setup() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required")
  execSync("prisma migrate deploy", { stdio: "inherit" })
  const db = new PrismaClient()
  await db.chat.upsert({
    where: { telegramId },
    create: { telegramId, title: CHAT },
    update: { title: CHAT, active: true },
  })
  await db.$disconnect()
}
