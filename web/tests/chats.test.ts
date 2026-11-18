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

  it("answers a missing or out-of-range chat id with an error", async () => {
    for (const id of [999999, 2 ** 31])
      expect((await renameChat(form(id, "X"))).error).toBeTruthy()
  })

  it.each([
    ["spaces only", "   "],
    ["over 255 characters", "x".repeat(256)],
  ])(
    "answers a title with %s with a message and keeps the old one",
    async (_, title) => {
      const chat = await db.chat.create({
        data: { telegramId: BigInt(-100124), title: "Old" },
      })
      expect((await renameChat(form(chat.id, title))).error).toBe(
        "Название — от 1 до 255 символов"
      )
      expect(
        (await db.chat.findUniqueOrThrow({ where: { id: chat.id } })).title
      ).toBe("Old")
    }
  )

  it("answers an expired session with a message", async () => {
    session.current = null
    const chat = await db.chat.create({
      data: { telegramId: BigInt(-100125), title: "Old" },
    })
    expect((await renameChat(form(chat.id, "New"))).error).toBe(
      "Сессия истекла, войдите заново"
    )
    expect(
      (await db.chat.findUniqueOrThrow({ where: { id: chat.id } })).title
    ).toBe("Old")
  })
})
