import {
  deleteChat,
  discoverChats,
  renameChat,
} from "@/app/(dashboard-layout)/chats/actions"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/lib/db"
import { discoveryView } from "@/lib/settings"

const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("@/auth", () => ({ auth: async () => session.current }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`)
  },
}))

function form(id: number, title: string) {
  const f = new FormData()
  f.set("id", String(id))
  f.set("title", title)
  return f
}

describe("renameChat", () => {
  beforeEach(async () => {
    await db.chat.deleteMany()
    await db.manager.upsert({
      where: { login: "boss" },
      create: { login: "boss", passwordHash: "x", role: "superadmin" },
      update: { role: "superadmin", active: true },
    })
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

describe("deleteChat", () => {
  beforeEach(async () => {
    await db.chat.deleteMany()
    await db.schedule.deleteMany()
    await db.manager.upsert({
      where: { login: "boss" },
      create: { login: "boss", passwordHash: "x", role: "superadmin" },
      update: { role: "superadmin", active: true },
    })
    session.current = { user: { name: "boss" } }
  })

  function idForm(id: number) {
    const f = new FormData()
    f.set("id", String(id))
    return f
  }

  it("asks the bot to delete the chat, unbinds its schedule and goes back to the list", async () => {
    const schedule = await db.schedule.create({ data: { name: "Смена" } })
    const chat = await db.chat.create({
      data: {
        telegramId: BigInt(-100200),
        title: "ПВЗ",
        scheduleId: schedule.id,
      },
    })
    await expect(deleteChat(idForm(chat.id))).rejects.toThrow("redirect /chats")
    const row = await db.chat.findUniqueOrThrow({ where: { id: chat.id } })
    expect([row.deleting, row.scheduleId]).toEqual([true, null])
  })

  it("answers a missing chat with an error", async () => {
    expect((await deleteChat(idForm(999999))).error).toBe(
      "Чат не найден — обновите страницу"
    )
  })

  it("answers an expired session with a message and keeps the chat", async () => {
    session.current = null
    const chat = await db.chat.create({
      data: { telegramId: BigInt(-100201), title: "ПВЗ" },
    })
    expect((await deleteChat(idForm(chat.id))).error).toBe(
      "Сессия истекла, войдите заново"
    )
    expect(
      (await db.chat.findUniqueOrThrow({ where: { id: chat.id } })).deleting
    ).toBe(false)
  })
})

describe("discoverChats", () => {
  const scan = () =>
    db.chatDiscovery.findUnique({
      where: { id: 1 },
      select: { state: true, found: true, added: true, error: true },
    })

  beforeEach(async () => {
    await db.chatDiscovery.deleteMany()
    await db.settings.upsert({
      where: { id: 1 },
      create: { apiSession: "cipher", botSeenAt: new Date() },
      update: { apiSession: "cipher", botSeenAt: new Date() },
    })
    await db.manager.upsert({
      where: { login: "boss" },
      create: { login: "boss", passwordHash: "x", role: "superadmin" },
      update: { role: "superadmin", active: true },
    })
    session.current = { user: { name: "boss" } }
  })

  it("queues a scan for the bot", async () => {
    expect(await discoverChats()).toEqual({})
    expect(await scan()).toEqual({
      state: "queued",
      found: null,
      added: null,
      error: null,
    })
  })

  it("starts a new scan after a finished one and leaves a running one alone", async () => {
    await db.chatDiscovery.create({
      data: { state: "done", found: 3, added: 1, error: "x" },
    })
    await discoverChats()
    expect(await scan()).toEqual({
      state: "queued",
      found: null,
      added: null,
      error: null,
    })
    await db.chatDiscovery.update({
      where: { id: 1 },
      data: { state: "running" },
    })
    await discoverChats()
    expect((await scan())?.state).toBe("running")
  })

  it("queues again a scan the bot has not answered", async () => {
    const old = new Date(Date.now() - 3 * 60_000)
    await db.chatDiscovery.create({ data: { state: "queued", updatedAt: old } })
    await db.$executeRaw`UPDATE chat_discovery SET updated_at = ${old}`
    expect((await discoveryView())?.stuck).toBe(true)
    await discoverChats()
    const row = await db.chatDiscovery.findUniqueOrThrow({ where: { id: 1 } })
    expect(+row.updatedAt).toBeGreaterThan(+old)
    expect((await discoveryView())?.stuck).toBe(false)
    // a running scan may wait out a long FLOOD_WAIT: only a silent bot makes it stuck
    await db.$executeRaw`UPDATE chat_discovery SET state = 'running', updated_at = ${old}`
    expect((await discoveryView())?.stuck).toBe(false)
    await db.settings.update({ where: { id: 1 }, data: { botSeenAt: old } })
    expect((await discoveryView())?.stuck).toBe(true)
    await discoverChats()
    expect((await scan())?.state).toBe("queued")
  })

  it("explains that the scan needs the Telegram account", async () => {
    await db.settings.update({ where: { id: 1 }, data: { apiSession: null } })
    expect((await discoverChats()).error).toMatch(/Настройках/)
    expect(await scan()).toBeNull()
  })

  it("is for the superadmin only", async () => {
    await db.manager.upsert({
      where: { login: "clerk" },
      create: { login: "clerk", passwordHash: "x" },
      update: { role: "manager", active: true },
    })
    session.current = { user: { name: "clerk" } }
    expect((await discoverChats()).error).toBe(
      "Искать группы может только суперадмин"
    )
    session.current = null
    expect((await discoverChats()).error).toBe("Сессия истекла, войдите заново")
    expect(await scan()).toBeNull()
  })
})
