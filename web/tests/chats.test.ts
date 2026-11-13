import { renameChat } from "@/app/(dashboard-layout)/chats/actions"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/lib/db"

const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("@/auth", () => ({ auth: async () => session.current }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

function form(id: number, title: string) {
  const f = new FormData()
  f.set("id", String(id))
  f.set("title", title)
  return f
}

describe("renameChat", () => {
  beforeEach(async () => {
    await db.chat.deleteMany()
    session.current = { user: { name: "boss" } }
  })

  it("renames a chat for a signed-in manager", async () => {
    const chat = await db.chat.create({
      data: { telegramId: BigInt(-100123), title: "Old" },
    })
    await renameChat(form(chat.id, "  Пункт на Ленина  "))
    expect(
      (await db.chat.findUniqueOrThrow({ where: { id: chat.id } })).title
    ).toBe("Пункт на Ленина")
  })

  it("rejects an empty title", async () => {
    const chat = await db.chat.create({
      data: { telegramId: BigInt(-100124), title: "Old" },
    })
    await expect(renameChat(form(chat.id, "   "))).rejects.toThrow()
    expect(
      (await db.chat.findUniqueOrThrow({ where: { id: chat.id } })).title
    ).toBe("Old")
  })

  it("refuses when not signed in", async () => {
    session.current = null
    const chat = await db.chat.create({
      data: { telegramId: BigInt(-100125), title: "Old" },
    })
    await expect(renameChat(form(chat.id, "New"))).rejects.toThrow(
      "Unauthorized"
    )
    expect(
      (await db.chat.findUniqueOrThrow({ where: { id: chat.id } })).title
    ).toBe("Old")
  })
})
