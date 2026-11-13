import {
  bindChat,
  bindChats,
  deleteSchedule,
  saveSchedule,
} from "@/app/(dashboard-layout)/schedules/actions"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/lib/db"

const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("@/auth", () => ({ auth: async () => session.current }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

type Item = {
  itemId?: number
  templateId: number
  time: string
  startDate: string
  period: string
}

function form(
  fields: Record<string, string | number | undefined>,
  items: Item[] = []
) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields))
    if (v !== undefined) f.append(k, String(v))
  for (const i of items) {
    f.append("itemId", String(i.itemId ?? ""))
    f.append("templateId", String(i.templateId))
    f.append("time", i.time)
    f.append("startDate", i.startDate)
    f.append("period", i.period)
  }
  return f
}

async function itemsOf(scheduleId: number) {
  const rows = await db.scheduleItem.findMany({
    where: { scheduleId },
    orderBy: { time: "asc" },
  })
  return rows.map((r) => ({
    templateId: r.templateId,
    time: r.time,
    startDate: r.startDate.toISOString().slice(0, 10),
    period: r.period,
  }))
}

let tpl: number
let tpl2: number
const chats: number[] = []

describe("schedules", () => {
  beforeEach(async () => {
    await db.sendLog.deleteMany()
    await db.chat.deleteMany()
    await db.scheduleItem.deleteMany()
    await db.schedule.deleteMany()
    await db.template.deleteMany()
    session.current = { user: { name: "boss" } }
    tpl = (
      await db.template.create({
        data: {
          name: "Опрос",
          kind: "poll",
          text: "?",
          options: ["Да", "Нет"],
        },
      })
    ).id
    tpl2 = (
      await db.template.create({
        data: { name: "Текст", kind: "text", text: "!" },
      })
    ).id
    chats.length = 0
    for (const n of [1, 2, 3])
      chats.push(
        (
          await db.chat.create({
            data: { telegramId: BigInt(-100 - n), title: `ПВЗ ${n}` },
          })
        ).id
      )
  })

  const morning: Item = {
    templateId: 0,
    time: "08:00",
    startDate: "2026-03-01",
    period: "day",
  }

  async function shared() {
    await saveSchedule(
      null,
      form({ name: "Смена 08:00" }, [{ ...morning, templateId: tpl }])
    )
    const s = await db.schedule.findFirstOrThrow()
    await bindChats(bindForm(s.id, chats))
    return s
  }

  function bindForm(id: number, chatIds: number[]) {
    const f = form({ id })
    for (const c of chatIds) f.append("chatId", String(c))
    return f
  }

  it("creates a schedule with its items", async () => {
    const r = await saveSchedule(
      null,
      form({ name: " Смена 08:00 " }, [
        { ...morning, templateId: tpl },
        {
          templateId: tpl2,
          time: "21:10",
          startDate: "2026-03-02",
          period: "month",
        },
      ])
    )
    expect(r.error).toBeUndefined()
    const s = await db.schedule.findFirstOrThrow()
    expect(s.name).toBe("Смена 08:00")
    expect(await itemsOf(s.id)).toEqual([
      { ...morning, templateId: tpl },
      {
        templateId: tpl2,
        time: "21:10",
        startDate: "2026-03-02",
        period: "month",
      },
    ])
  })

  it.each([
    ["a bad time", { time: "24:00" }],
    ["an unknown period", { period: "yearly" }],
    ["a bad date", { startDate: "01.03.2026" }],
  ])("rejects an item with %s", async (_, over) => {
    const r = await saveSchedule(
      null,
      form({ name: "S" }, [{ ...morning, templateId: tpl, ...over }])
    )
    expect(r.error).toBeTruthy()
    expect(await db.schedule.count()).toBe(0)
  })

  it("reports a duplicate name instead of throwing", async () => {
    await saveSchedule(null, form({ name: "S" }))
    expect((await saveSchedule(null, form({ name: "S" }))).error).toMatch(
      /уже есть/
    )
  })

  it("binds chats to a schedule, moving them off their old one", async () => {
    const s = await shared()
    await saveSchedule(null, form({ name: "Другое" }))
    const other = await db.schedule.findFirstOrThrow({
      where: { name: "Другое" },
    })
    await bindChats(bindForm(other.id, [chats[0]]))
    await bindChats(bindForm(s.id, [chats[1]]))
    const bound = await db.chat.findMany({ orderBy: { id: "asc" } })
    expect(bound.map((c) => c.scheduleId)).toEqual([other.id, s.id, null])
  })

  it("binds one chat from its page and unbinds with an empty choice", async () => {
    const s = await shared()
    await bindChat(form({ chatId: chats[0], scheduleId: "" }))
    await bindChat(form({ chatId: chats[1], scheduleId: s.id }))
    const bound = await db.chat.findMany({ orderBy: { id: "asc" } })
    expect(bound.map((c) => c.scheduleId)).toEqual([null, s.id, s.id])
  })

  it("an edit 'in all chats' changes the shared schedule for every chat", async () => {
    const s = await shared()
    const edited = [{ ...morning, templateId: tpl, time: "08:30" }]
    const r = await saveSchedule(
      null,
      form({ id: s.id, name: s.name, chatId: chats[0], scope: "all" }, edited)
    )
    expect(r.error).toBeUndefined()
    expect(await db.schedule.count()).toBe(1)
    expect(await itemsOf(s.id)).toEqual(edited)
  })

  it("an edit 'only in this chat' clones the schedule for that chat (copy-on-write)", async () => {
    const s = await shared()
    const edited = [
      { ...morning, templateId: tpl, time: "08:30" },
      {
        templateId: tpl2,
        time: "09:00",
        startDate: "2026-03-01",
        period: "week",
      },
    ]
    const r = await saveSchedule(
      null,
      form({ id: s.id, name: s.name, chatId: chats[0], scope: "this" }, edited)
    )
    expect(r.error).toBeUndefined()

    const chat = await db.chat.findUniqueOrThrow({
      where: { id: chats[0] },
      include: { schedule: true },
    })
    expect(chat.scheduleId).not.toBe(s.id)
    expect(chat.schedule?.name).toBe("Смена 08:00 (ПВЗ 1)")
    expect(await itemsOf(chat.scheduleId!)).toEqual(edited)

    // the original and the other chats are untouched
    expect(await itemsOf(s.id)).toEqual([{ ...morning, templateId: tpl }])
    const others = await db.chat.findMany({
      where: { id: { in: chats.slice(1) } },
    })
    expect(others.map((c) => c.scheduleId)).toEqual([s.id, s.id])
  })

  it("a copy saved in the firing minute carries the chat's send log, so it does not resend", async () => {
    const s = await shared()
    const [item] = await db.scheduleItem.findMany({
      where: { scheduleId: s.id },
    })
    const slot = new Date()
    for (const chatId of [chats[0], chats[1]])
      await db.sendLog.create({
        data: { chatId, scheduleItemId: item.id, slot },
      })
    await saveSchedule(
      null,
      form({ id: s.id, name: s.name, chatId: chats[0], scope: "this" }, [
        { ...morning, templateId: tpl, period: "week", itemId: item.id },
      ])
    )
    const copy = await db.chat.findUniqueOrThrow({ where: { id: chats[0] } })
    const [copyItem] = await db.scheduleItem.findMany({
      where: { scheduleId: copy.scheduleId! },
    })
    const logs = await db.sendLog.findMany({ orderBy: { chatId: "asc" } })
    // this chat's claim moved to the copy's item; the other chat's stays on the original
    expect(logs.map((l) => l.scheduleItemId)).toEqual([copyItem.id, item.id])
  })

  it("two items with the same template can swap times", async () => {
    await saveSchedule(null, form({ name: "S" }))
    const s = await db.schedule.findFirstOrThrow()
    const a = { ...morning, templateId: tpl, time: "08:00" }
    const b = { ...morning, templateId: tpl, time: "09:00" }
    await saveSchedule(null, form({ id: s.id, name: "S" }, [a, b]))
    const [ia, ib] = await db.scheduleItem.findMany({
      where: { scheduleId: s.id },
      orderBy: { time: "asc" },
    })
    const r = await saveSchedule(
      null,
      form({ id: s.id, name: "S" }, [
        { ...a, time: "09:00", itemId: ia.id },
        { ...b, time: "08:00", itemId: ib.id },
      ])
    )
    expect(r.error).toBeUndefined()
    const after = await db.scheduleItem.findMany({
      where: { scheduleId: s.id },
      orderBy: { time: "asc" },
    })
    expect(after.map((i) => [i.id, i.time])).toEqual([
      [ib.id, "08:00"],
      [ia.id, "09:00"],
    ])
  })

  it("'only in this chat' keeps a name the manager changed", async () => {
    const s = await shared()
    await saveSchedule(
      null,
      form({ id: s.id, name: "Моя смена", chatId: chats[0], scope: "this" }, [])
    )
    const chat = await db.chat.findUniqueOrThrow({
      where: { id: chats[0] },
      include: { schedule: true },
    })
    expect(chat.schedule?.name).toBe("Моя смена")
    expect(
      (await db.schedule.findUniqueOrThrow({ where: { id: s.id } })).name
    ).toBe("Смена 08:00")
  })

  it("'only in this chat' edits in place when no other chat shares the schedule", async () => {
    const s = await shared()
    await bindChats(bindForm(s.id, [chats[0]]))
    const edited = [{ ...morning, templateId: tpl, time: "07:00" }]
    await saveSchedule(
      null,
      form({ id: s.id, name: s.name, chatId: chats[0], scope: "this" }, edited)
    )
    expect(await db.schedule.count()).toBe(1)
    expect(await itemsOf(s.id)).toEqual(edited)
  })

  it("an edit keeps existing items by id, so a save in the firing minute does not resend", async () => {
    const s = await shared()
    const [item] = await db.scheduleItem.findMany({
      where: { scheduleId: s.id },
    })
    await db.sendLog.create({
      data: { chatId: chats[0], scheduleItemId: item.id, slot: new Date() },
    })
    const extra = {
      templateId: tpl2,
      time: "09:00",
      startDate: "2026-03-01",
      period: "week",
    }
    const r = await saveSchedule(
      null,
      form({ id: s.id, name: s.name }, [
        { ...morning, templateId: tpl, period: "week", itemId: item.id },
        extra,
      ])
    )
    expect(r.error).toBeUndefined()
    const after = await db.scheduleItem.findMany({
      where: { scheduleId: s.id },
      orderBy: { time: "asc" },
    })
    expect(after.map((i) => [i.id === item.id, i.period])).toEqual([
      [true, "week"],
      [false, "week"],
    ])
    expect((await db.sendLog.findFirstOrThrow()).scheduleItemId).toBe(item.id)

    // a row left out of the form is removed
    await saveSchedule(
      null,
      form({ id: s.id, name: s.name }, [{ ...extra, itemId: after[1].id }])
    )
    expect(
      (await db.scheduleItem.findMany({ where: { scheduleId: s.id } })).map(
        (i) => i.id
      )
    ).toEqual([after[1].id])
  })

  it("'only in this chat' picks a free name when the copy's name is taken", async () => {
    const s = await shared()
    await saveSchedule(null, form({ name: "Смена 08:00 (ПВЗ 1)" }))
    const r = await saveSchedule(
      null,
      form({ id: s.id, name: s.name, chatId: chats[0], scope: "this" }, [])
    )
    expect(r.error).toBeUndefined()
    const chat = await db.chat.findUniqueOrThrow({
      where: { id: chats[0] },
      include: { schedule: true },
    })
    expect(chat.schedule?.name).toBe("Смена 08:00 (ПВЗ 1) 2")
  })

  it("deletes a schedule and unbinds its chats", async () => {
    const s = await shared()
    await deleteSchedule(form({ id: s.id }))
    expect(await db.schedule.count()).toBe(0)
    expect((await db.chat.findMany()).every((c) => c.scheduleId === null)).toBe(
      true
    )
  })

  it("refuses when not signed in", async () => {
    session.current = null
    await expect(saveSchedule(null, form({ name: "S" }))).rejects.toThrow(
      "Unauthorized"
    )
  })
})
