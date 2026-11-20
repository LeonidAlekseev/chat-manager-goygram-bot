import { cancelSend, sendNow } from "@/app/(dashboard-layout)/send/actions"
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
    await db.manager.upsert({
      where: { login: "boss" },
      create: { login: "boss", passwordHash: "x", role: "superadmin" },
      update: { role: "superadmin", active: true },
    })
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

  it("queues custom text with mention all", async () => {
    await sendNow(
      null,
      form({ text: "Все сюда", mentionAll: "on", chatIds: String(chats[0]) })
    )
    const [o] = await db.outbox.findMany()
    expect([o.text, o.mentionAll]).toEqual(["Все сюда", true])
  })

  it("a template job takes mention all from the template, not the form", async () => {
    await sendNow(
      null,
      form({
        templateId: String(templateId),
        mentionAll: "on",
        chatIds: String(chats[0]),
      })
    )
    expect((await db.outbox.findFirstOrThrow()).mentionAll).toBe(false)
  })

  it("explains that only one of template and text may be chosen", async () => {
    const r = await sendNow(
      null,
      form({
        text: "x",
        templateId: String(templateId),
        chatIds: String(chats[0]),
      })
    )
    expect(r.error).toBe(
      "Выберите что-то одно: шаблон, свой текст или свой опрос"
    )
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

  it("rejects a chat that is being deleted", async () => {
    await db.chat.update({ where: { id: chats[0] }, data: { deleting: true } })
    expect(
      (await sendNow(null, form({ text: "x", chatIds: String(chats[0]) })))
        .error
    ).toBeTruthy()
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

  it("records the signed-in manager as the job's author", async () => {
    await sendNow(null, form({ text: "x", chatIds: String(chats[0]) }))
    const boss = await db.manager.findUniqueOrThrow({
      where: { login: "boss" },
    })
    expect((await db.outbox.findFirstOrThrow()).authorId).toBe(boss.id)
  })

  describe("custom poll", () => {
    const poll = (extra: Record<string, string | string[]> = {}) =>
      sendNow(
        null,
        form({
          question: " Обед? ",
          options: " Да \n\n Нет \n",
          chatIds: String(chats[0]),
          ...extra,
        })
      )

    it("queues the question, options and flags", async () => {
      expect(
        await poll({ anonymous: "on", multiple: "on", mentionAll: "on" })
      ).toEqual({})
      const o = await db.outbox.findFirstOrThrow()
      expect([
        o.templateId,
        o.text,
        o.options,
        o.anonymous,
        o.multiple,
        o.mentionAll,
      ]).toEqual([null, "Обед?", ["Да", "Нет"], true, true, true])
    })

    it("needs 2-10 options of up to 100 chars and a question of up to 300", async () => {
      expect((await poll({ options: "Да" })).error).toBe(
        "Нужно минимум 2 варианта"
      )
      expect(
        (await poll({ options: Array(11).fill("x").join("\n") })).error
      ).toBe("Не больше 10 вариантов")
      expect(
        (await poll({ options: `Да\n${"x".repeat(101)}` })).error
      ).toBeTruthy()
      expect((await poll({ question: "x".repeat(301) })).error).toBeTruthy()
      expect(await db.outbox.count()).toBe(0)
    })

    it("is one choice: not together with a template or text", async () => {
      expect(
        (await poll({ templateId: String(templateId) })).error
      ).toBeTruthy()
      expect((await poll({ text: "x" })).error).toBeTruthy()
      expect(await db.outbox.count()).toBe(0)
    })

    it("plain text never carries poll options", async () => {
      await sendNow(
        null,
        form({ text: "x", options: "a\nb", chatIds: String(chats[0]) })
      )
      expect((await db.outbox.findFirstOrThrow()).options).toEqual([])
    })
  })

  describe("send later", () => {
    it("stores the local time (Europe/Moscow) as UTC", async () => {
      expect(
        await sendNow(
          null,
          form({
            text: "x",
            sendAt: "2030-01-01T10:00",
            chatIds: String(chats[0]),
          })
        )
      ).toEqual({})
      const o = await db.outbox.findFirstOrThrow()
      expect(o.sendAt?.toISOString()).toBe("2030-01-01T07:00:00.000Z")
    })

    it("without a time sends at once", async () => {
      await sendNow(null, form({ text: "x", chatIds: String(chats[0]) }))
      expect((await db.outbox.findFirstOrThrow()).sendAt).toBeNull()
    })

    it("refuses a time that has passed or is malformed", async () => {
      const past = await sendNow(
        null,
        form({
          text: "x",
          sendAt: "2020-01-01T10:00",
          chatIds: String(chats[0]),
        })
      )
      expect(past.error).toBe(
        "Время отправки уже прошло (Europe/Moscow) — укажите будущее"
      )
      expect(
        (
          await sendNow(
            null,
            form({ text: "x", sendAt: "завтра", chatIds: String(chats[0]) })
          )
        ).error
      ).toBeTruthy()
      expect(
        (
          await sendNow(
            null,
            form({
              text: "x",
              sendAt: "2030-13-01T10:00",
              chatIds: String(chats[0]),
            })
          )
        ).error
      ).toBe("Укажите дату и время")
      expect(await db.outbox.count()).toBe(0)
    })
  })

  describe("cancelSend", () => {
    const later = new Date(Date.now() + 3600_000)
    const job = async (data: { authorId?: number; sendAt?: Date | null }) =>
      (
        await db.outbox.create({
          data: { chatId: chats[0], text: "x", sendAt: later, ...data },
        })
      ).id
    const cancel = (id: number) => cancelSend(form({ id: String(id) }))
    let m1: number, m2: number

    beforeEach(async () => {
      await db.manager.deleteMany({ where: { login: { startsWith: "send-" } } })
      ;[m1, m2] = (
        await Promise.all(
          ["send-m1", "send-m2"].map((login) =>
            db.manager.create({ data: { login, passwordHash: "x" } })
          )
        )
      ).map((m) => m.id)
      await db.chatManager.createMany({
        data: [m1, m2].map((managerId) => ({ chatId: chats[0], managerId })),
      })
    })

    it("lets the author cancel a scheduled job before it is sent", async () => {
      session.current = { user: { name: "send-m1" } }
      const id = await job({ authorId: m1 })
      expect(await cancel(id)).toEqual({})
      expect(await db.outbox.count()).toBe(0)
    })

    it("lets the superadmin cancel anyone's scheduled job", async () => {
      const id = await job({ authorId: m1 })
      expect(await cancel(id)).toEqual({})
      expect(await db.outbox.count()).toBe(0)
    })

    it("refuses another manager's job, a due or claimed job, and a hidden chat", async () => {
      session.current = { user: { name: "send-m2" } }
      const other = await job({ authorId: m1 })
      expect((await cancel(other)).error).toBeTruthy()
      session.current = { user: { name: "send-m1" } }
      const due = await job({ authorId: m1, sendAt: null })
      expect((await cancel(due)).error).toBeTruthy()
      const claimed = await job({ authorId: m1 })
      await db.sendLog.create({
        data: { chatId: chats[0], slot: new Date(), outboxId: claimed },
      })
      expect((await cancel(claimed)).error).toBeTruthy()
      await db.chatManager.deleteMany({ where: { managerId: m1 } })
      const hidden = await job({ authorId: m1 })
      expect((await cancel(hidden)).error).toBeTruthy()
      expect(await db.outbox.count()).toBe(4)
    })
  })
})
