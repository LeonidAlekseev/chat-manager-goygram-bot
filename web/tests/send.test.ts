import { sendNow } from "@/app/(dashboard-layout)/send/actions"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/lib/db"

const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("@/auth", () => ({ auth: async () => session.current }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

function form(fields: Record<string, string | string[]>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields))
    for (const x of [v].flat()) f.append(k, x)
  return f
}

describe("sendNow", () => {
  let chats: number[]
  let templateId: number

  beforeEach(async () => {
    await db.outbox.deleteMany()
    await db.sendLog.deleteMany()
    await db.template.deleteMany()
    await db.chat.deleteMany()
    session.current = { user: { name: "boss" } }
    chats = (
      await Promise.all(
        [-1, -2].map((n) =>
          db.chat.create({ data: { telegramId: BigInt(n), title: `c${n}` } })
        )
      )
    ).map((c) => c.id)
    templateId = (
      await db.template.create({
        data: { name: "t", kind: "text", text: "hi" },
      })
    ).id
  })

  it("queues a template job per selected chat", async () => {
    const r = await sendNow(
      null,
      form({ templateId: String(templateId), chatIds: chats.map(String) })
    )
    expect(r).toEqual({})
    const rows = await db.outbox.findMany({ orderBy: { id: "asc" } })
    expect(rows.map((o) => [o.chatId, o.templateId, o.text])).toEqual(
      chats.map((c) => [c, templateId, null])
    )
  })

  it("queues custom text", async () => {
    await sendNow(
      null,
      form({ text: "  Сегодня короткий день ", chatIds: String(chats[0]) })
    )
    const [o] = await db.outbox.findMany()
    expect([o.templateId, o.text]).toEqual([null, "Сегодня короткий день"])
  })

  it("treats spaces-only text as no text, so the template is sent", async () => {
    const r = await sendNow(
      null,
      form({
        text: "   ",
        templateId: String(templateId),
        chatIds: String(chats[0]),
      })
    )
    expect(r).toEqual({})
    const [o] = await db.outbox.findMany()
    expect([o.templateId, o.text]).toEqual([templateId, null])
    expect(
      (await sendNow(null, form({ text: "   ", chatIds: String(chats[0]) })))
        .error
    ).toBeTruthy()
  })

  it("needs exactly one of template and text, and at least one chat", async () => {
    expect(
      (await sendNow(null, form({ chatIds: String(chats[0]) }))).error
    ).toBeTruthy()
    expect(
      (
        await sendNow(
          null,
          form({
            text: "x",
            templateId: String(templateId),
            chatIds: String(chats[0]),
          })
        )
      ).error
    ).toBeTruthy()
    expect((await sendNow(null, form({ text: "x" }))).error).toBeTruthy()
    expect(await db.outbox.count()).toBe(0)
  })

  it("rejects an unknown chat or template", async () => {
    expect(
      (await sendNow(null, form({ text: "x", chatIds: "999999" }))).error
    ).toBeTruthy()
    expect(
      (
        await sendNow(
          null,
          form({ templateId: "999999", chatIds: String(chats[0]) })
        )
      ).error
    ).toBeTruthy()
    expect(await db.outbox.count()).toBe(0)
  })

  it("refuses when not signed in", async () => {
    session.current = null
    await expect(
      sendNow(null, form({ text: "x", chatIds: String(chats[0]) }))
    ).rejects.toThrow("Unauthorized")
    expect(await db.outbox.count()).toBe(0)
  })
})
