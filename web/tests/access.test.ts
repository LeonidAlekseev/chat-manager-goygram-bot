import {
  assignManagers,
  deleteChat,
  renameChat,
} from "@/app/(dashboard-layout)/chats/actions"
import {
  bindChat,
  bindChats,
  deleteSchedule,
  duplicateSchedule,
  saveSchedule,
} from "@/app/(dashboard-layout)/schedules/actions"
import { sendNow } from "@/app/(dashboard-layout)/send/actions"
import {
  deleteTemplate,
  duplicateTemplate,
  saveTemplate,
} from "@/app/(dashboard-layout)/templates/actions"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Viewer } from "@/lib/access"

import {
  visibleChats,
  visibleSchedules,
  visibleSends,
  visibleTemplates,
} from "@/lib/access"
import { db } from "@/lib/db"

const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("@/auth", () => ({ auth: async () => session.current }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`)
  },
}))

function form(fields: Record<string, string | number | (string | number)[]>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, String(x))
  return f
}
const as = (login: string) => (session.current = { user: { name: login } })

let root: Viewer, m1: Viewer, m2: Viewer
const chat: Record<string, number> = {}
const tpl: Record<string, number> = {}
const sch: Record<string, number> = {}

describe("manager scopes (#92)", () => {
  beforeEach(async () => {
    await db.outbox.deleteMany()
    await db.sendLog.deleteMany()
    await db.chat.deleteMany()
    await db.scheduleItem.deleteMany()
    await db.schedule.deleteMany()
    await db.template.deleteMany()
    await db.manager.deleteMany({ where: { login: { startsWith: "acc-" } } })
    const mk = (login: string, role: "superadmin" | "manager") =>
      db.manager.create({
        data: { login, role, passwordHash: "x" },
        select: { id: true, role: true },
      })
    root = await mk("acc-root", "superadmin")
    m1 = await mk("acc-m1", "manager")
    m2 = await mk("acc-m2", "manager")
    for (const [k, managers] of [
      ["c1", [m1.id]],
      ["c2", [m2.id]],
      ["c3", []],
    ] as const)
      chat[k] = (
        await db.chat.create({
          data: {
            telegramId: -Math.floor(Math.random() * 1e12),
            title: k,
            managers: {
              create: managers.map((managerId) => ({ managerId })),
            },
          },
        })
      ).id
    for (const [k, authorId] of [
      ["super", root.id],
      ["none", null],
      ["own", m1.id],
      ["other", m2.id],
    ] as const) {
      tpl[k] = (
        await db.template.create({
          data: { name: `t-${k}`, kind: "text", text: k, authorId },
        })
      ).id
      sch[k] = (
        await db.schedule.create({
          data: {
            name: `s-${k}`,
            authorId,
            items: { create: { templateId: tpl[k], time: "08:00" } },
          },
        })
      ).id
    }
    as("acc-m1")
  })

  describe("visibility", () => {
    it("a manager sees the superadmin's templates and schedules and their own", async () => {
      const names = async (rows: Promise<{ name: string }[]>) =>
        (await rows).map((r) => r.name).sort()
      expect(
        await names(db.template.findMany({ where: visibleTemplates(m1) }))
      ).toEqual(["t-none", "t-own", "t-super"])
      expect(
        await names(db.schedule.findMany({ where: visibleSchedules(m1) }))
      ).toEqual(["s-none", "s-own", "s-super"])
      expect(await db.template.count({ where: visibleTemplates(root) })).toBe(4)
    })

    it("a manager sees only assigned chats; the superadmin sees all", async () => {
      expect(
        (await db.chat.findMany({ where: visibleChats(m1) })).map((c) => c.id)
      ).toEqual([chat.c1])
      expect(await db.chat.count({ where: visibleChats(root) })).toBe(3)
    })

    it("the journal shows assigned chats only, without other managers' templates", async () => {
      const log = (c: number, templateId: number | null, slot: number) =>
        db.sendLog.create({
          data: { chatId: c, templateId, slot: new Date(slot) },
        })
      const a = await log(chat.c1, tpl.super, 1)
      await log(chat.c1, tpl.other, 2)
      await log(chat.c2, tpl.own, 3)
      const d = await log(chat.c1, null, 4)
      expect(
        (await db.sendLog.findMany({ where: visibleSends(m1) }))
          .map((l) => l.id)
          .sort()
      ).toEqual([a.id, d.id].sort())
      expect(await db.sendLog.count({ where: visibleSends(root) })).toBe(4)
    })
  })

  describe("templates", () => {
    const edit = (id: number) =>
      form({ id, name: "Новое", kind: "text", text: "x" })

    it("a manager edits and deletes only their own", async () => {
      expect((await saveTemplate(null, edit(tpl.own))).error).toBeUndefined()
      expect((await saveTemplate(null, edit(tpl.other))).error).toMatch(
        /Не найдено/
      )
      expect((await saveTemplate(null, edit(tpl.super))).error).toBe(
        "Это шаблон суперадмина — изменить нельзя"
      )
      expect((await saveTemplate(null, edit(tpl.none))).error).toMatch(
        /суперадмина/
      )
      expect(
        (await deleteTemplate(null, form({ id: tpl.other }))).error
      ).toMatch(/Не найдено/)
      expect(
        (await deleteTemplate(null, form({ id: tpl.super }))).error
      ).toMatch(/суперадмина/)
      expect(
        (await db.template.findMany({ where: { name: "Новое" } })).map(
          (t) => t.id
        )
      ).toEqual([tpl.own])
      expect(await db.template.count()).toBe(4)
    })

    it("the superadmin edits a manager's template", async () => {
      as("acc-root")
      expect((await saveTemplate(null, edit(tpl.other))).error).toBeUndefined()
    })
  })

  describe("schedules", () => {
    const item = (templateId: number) => ({
      templateId,
      time: "09:00",
      startDate: "2030-01-01",
      period: "day",
    })
    const save = (
      fields: Record<string, string | number>,
      items: ReturnType<typeof item>[]
    ) =>
      saveSchedule(
        null,
        form({
          ...fields,
          templateId: items.map((i) => i.templateId),
          time: items.map((i) => i.time),
          startDate: items.map((i) => i.startDate),
          period: items.map((i) => i.period),
        })
      )

    it("a new schedule is the manager's, with visible templates only", async () => {
      expect((await save({ name: "bad" }, [item(tpl.other)])).error).toMatch(
        /Не найдено/
      )
      expect(
        (await save({ name: "mine" }, [item(tpl.super), item(tpl.own)])).error
      ).toBeUndefined()
      expect(
        (await db.schedule.findUniqueOrThrow({ where: { name: "mine" } }))
          .authorId
      ).toBe(m1.id)
      expect(await db.schedule.count({ where: { name: "bad" } })).toBe(0)
    })

    it("a manager edits and deletes only their own", async () => {
      expect(
        (await save({ id: sch.super, name: "x" }, [item(tpl.super)])).error
      ).toBe("Это расписание суперадмина — изменить нельзя")
      expect(
        (await save({ id: sch.other, name: "x" }, [item(tpl.super)])).error
      ).toMatch(/Не найдено/)
      expect(
        (await save({ id: sch.own, name: "x" }, [item(tpl.own)])).error
      ).toBeUndefined()
      expect(
        (await save({ id: sch.own, name: "y" }, [item(tpl.other)])).error
      ).toMatch(/Не найдено/)
      expect((await deleteSchedule(form({ id: sch.super }))).error).toMatch(
        /суперадмина/
      )
      expect((await deleteSchedule(form({ id: sch.other }))).error).toMatch(
        /Не найдено/
      )
      expect(await db.schedule.count()).toBe(4)
    })

    it.each([
      ["shared with another chat", true],
      ["bound to this chat only", false],
    ])(
      "«only this chat» on the superadmin's schedule (%s) makes the manager's copy",
      async (_, shared) => {
        await db.chat.updateMany({
          where: { id: { in: shared ? [chat.c1, chat.c3] : [chat.c1] } },
          data: { scheduleId: sch.super },
        })
        const r = await save(
          { id: sch.super, name: "s-super", chatId: chat.c1, scope: "this" },
          [item(tpl.own)]
        )
        expect(r.error).toBeUndefined()
        const c1 = await db.chat.findUniqueOrThrow({
          where: { id: chat.c1 },
          include: { schedule: { include: { items: true } } },
        })
        expect(c1.schedule).toMatchObject({ authorId: m1.id })
        expect(c1.schedule!.items.map((i) => i.templateId)).toEqual([tpl.own])
        // the original stays as it was
        expect(
          (
            await db.scheduleItem.findMany({ where: { scheduleId: sch.super } })
          ).map((i) => i.templateId)
        ).toEqual([tpl.super])
      }
    )

    it("«only this chat» needs a chat assigned to the manager", async () => {
      await db.chat.update({
        where: { id: chat.c2 },
        data: { scheduleId: sch.super },
      })
      const r = await save(
        { id: sch.super, name: "s-super", chatId: chat.c2, scope: "this" },
        [item(tpl.super)]
      )
      expect(r.error).toMatch(/Не найдено/)
      expect(await db.schedule.count()).toBe(4)
    })

    it("a manager binds a visible schedule to an assigned chat only", async () => {
      const bind = (chatId: number, scheduleId: number) =>
        bindChat(form({ chatId, scheduleId }))
      expect((await bind(chat.c1, sch.super)).error).toBeUndefined()
      expect((await bind(chat.c1, sch.other)).error).toMatch(/Не найдено/)
      expect((await bind(chat.c2, sch.own)).error).toMatch(/Не найдено/)
      const scheduleOf = async (id: number) =>
        (await db.chat.findUniqueOrThrow({ where: { id } })).scheduleId
      expect(await scheduleOf(chat.c1)).toBe(sch.super)
      expect(await scheduleOf(chat.c2)).toBeNull()
    })

    it("bindChats leaves chats the manager does not see alone", async () => {
      await db.chat.update({
        where: { id: chat.c3 },
        data: { scheduleId: sch.super },
      })
      expect(
        (await bindChats(form({ id: sch.super, chatId: [chat.c1] }))).error
      ).toBeUndefined()
      expect(await db.chat.count({ where: { scheduleId: sch.super } })).toBe(2) // c1 bound, c3 kept
      expect(
        (await bindChats(form({ id: sch.super, chatId: [chat.c2] }))).error
      ).toMatch(/Не найдено/)
      expect(
        (await bindChats(form({ id: sch.other, chatId: [chat.c1] }))).error
      ).toMatch(/Не найдено/)
      expect(
        (await db.chat.findUniqueOrThrow({ where: { id: chat.c2 } })).scheduleId
      ).toBeNull()
    })
  })

  describe("duplicate (#118)", () => {
    it("copies a visible template to the viewer, editable and not tied to an album", async () => {
      await db.template.update({
        where: { id: tpl.super },
        data: { kind: "copy", sourceChatId: 5, mediaGroupId: "g1" },
      })
      expect(
        (await duplicateTemplate(form({ id: tpl.super }))).error
      ).toBeUndefined()
      const copy = await db.template.findFirstOrThrow({
        where: { name: "t-super (копия)" },
      })
      expect(copy).toMatchObject({
        authorId: m1.id,
        kind: "copy",
        sourceChatId: BigInt(5),
        mediaGroupId: null,
      })
      expect(
        (
          await saveTemplate(
            null,
            form({ id: copy.id, name: "Мой", kind: "text", text: "x" })
          )
        ).error
      ).toBeUndefined()
    })

    it("a template copy is a clean object: same content and settings, own id, no chats, no link back", async () => {
      await db.template.update({
        where: { id: tpl.super },
        data: {
          kind: "poll",
          options: ["Да", "Нет"],
          anonymous: true,
          multiple: true,
          mentionAll: true,
        },
      })
      await duplicateTemplate(form({ id: tpl.super }))
      const [orig, copy] = await Promise.all([
        db.template.findUniqueOrThrow({ where: { id: tpl.super } }),
        db.template.findFirstOrThrow({ where: { name: "t-super (копия)" } }),
      ])
      expect(copy.id).not.toBe(orig.id)
      expect(copy).toMatchObject({
        authorId: m1.id,
        text: orig.text,
        kind: "poll",
        options: ["Да", "Нет"],
        anonymous: true,
        multiple: true,
        mentionAll: true,
      })
      expect(
        await db.scheduleItem.count({ where: { templateId: copy.id } })
      ).toBe(0)
    })

    it("refuses a template the viewer does not see", async () => {
      expect((await duplicateTemplate(form({ id: tpl.other }))).error).toMatch(
        /Не найдено/
      )
      expect(await db.template.count()).toBe(4)
    })

    it("copies a foreign schedule to the viewer, without chats and hidden-template items", async () => {
      await db.chat.update({
        where: { id: chat.c1 },
        data: { scheduleId: sch.super },
      })
      await db.scheduleItem.create({
        data: { scheduleId: sch.super, templateId: tpl.other, time: "10:00" },
      })
      expect(
        (await duplicateSchedule(form({ id: sch.super }))).error
      ).toBeUndefined()
      const copy = await db.schedule.findFirstOrThrow({
        where: { name: "s-super (копия)" },
        include: { items: true, chats: true },
      })
      expect(copy.authorId).toBe(m1.id)
      expect(copy.chats).toEqual([])
      expect(copy.items.map((i) => i.templateId)).toEqual([tpl.super])
      const [o] = await db.scheduleItem.findMany({
        where: { scheduleId: sch.super },
      })
      expect(copy.items[0]).toMatchObject({
        time: o.time,
        period: o.period,
        startDate: o.startDate,
      })
      expect(copy.items[0].id).not.toBe(o.id)
      // the original keeps its chat; the copy has none
      expect(
        (await db.chat.findUniqueOrThrow({ where: { id: chat.c1 } })).scheduleId
      ).toBe(sch.super)
      expect(
        (await duplicateSchedule(form({ id: sch.super }))).error
      ).toBeUndefined()
      expect(
        await db.schedule.count({ where: { name: "s-super (копия 2)" } })
      ).toBe(1)
      // the copy is the manager's own: editable
      expect(
        (await deleteSchedule(form({ id: copy.id }))).error
      ).toBeUndefined()
    })

    it("refuses a schedule the viewer does not see", async () => {
      expect((await duplicateSchedule(form({ id: sch.other }))).error).toMatch(
        /Не найдено/
      )
      expect(
        (await duplicateSchedule(form({ id: [sch.own, sch.super] }))).error
      ).toMatch(/Не найдено/)
    })

    it("refuses an item with no template chosen", async () => {
      const r = await saveSchedule(
        null,
        form({
          name: "Пусто",
          templateId: "",
          time: "09:00",
          startDate: "2030-01-01",
          period: "day",
        })
      )
      expect(r.error).toBe("Выберите шаблон")
      expect(await db.schedule.count({ where: { name: "Пусто" } })).toBe(0)
    })
  })

  describe("chats", () => {
    it("a manager renames only assigned chats", async () => {
      expect(
        (await renameChat(form({ id: chat.c2, title: "X" }))).error
      ).toBeTruthy()
      expect(
        (await renameChat(form({ id: chat.c1, title: "Y" }))).error
      ).toBeUndefined()
      expect(
        (await db.chat.findMany({ where: { title: { in: ["X", "Y"] } } })).map(
          (c) => c.id
        )
      ).toEqual([chat.c1])
    })

    it("only the superadmin deletes a chat", async () => {
      expect((await deleteChat(form({ id: chat.c1 }))).error).toBeTruthy()
      expect(
        (await db.chat.findUniqueOrThrow({ where: { id: chat.c1 } })).deleting
      ).toBe(false)
    })

    it("only the superadmin assigns managers; the manager then sees the chat", async () => {
      expect(
        (await assignManagers(form({ id: chat.c3, managerId: [m1.id] }))).error
      ).toBeTruthy()
      expect(await db.chat.count({ where: visibleChats(m1) })).toBe(1)
      as("acc-root")
      expect(
        (await assignManagers(form({ id: chat.c3, managerId: [m1.id, m2.id] })))
          .error
      ).toBeUndefined()
      expect(await db.chat.count({ where: visibleChats(m1) })).toBe(2)
      expect(
        (await assignManagers(form({ id: chat.c3, managerId: [m2.id] }))).error
      ).toBeUndefined()
      expect(await db.chat.count({ where: visibleChats(m1) })).toBe(1)
      expect(await db.chat.count({ where: visibleChats(m2) })).toBe(2)
    })

    it("unassigning a manager unbinds the chat from that manager's schedule", async () => {
      await db.chat.update({
        where: { id: chat.c1 },
        data: { scheduleId: sch.own }, // m1's
      })
      await db.chat.update({
        where: { id: chat.c2 },
        data: { scheduleId: sch.super },
      })
      as("acc-root")
      await assignManagers(form({ id: chat.c1, managerId: [m1.id, m2.id] }))
      const scheduleOf = async (id: number) =>
        (await db.chat.findUniqueOrThrow({ where: { id } })).scheduleId
      expect(await scheduleOf(chat.c1)).toBe(sch.own) // m1 still assigned
      await assignManagers(form({ id: chat.c1, managerId: [m2.id] }))
      expect(await scheduleOf(chat.c1)).toBeNull()
      // the superadmin's schedule stays when managers change
      await assignManagers(form({ id: chat.c2, managerId: [] }))
      expect(await scheduleOf(chat.c2)).toBe(sch.super)
    })

    it("a manager with templates or schedules cannot be deleted, so their rows never turn into the superadmin's", async () => {
      await expect(
        db.manager.delete({ where: { id: m2.id } })
      ).rejects.toThrow()
      expect(
        (await db.template.findUniqueOrThrow({ where: { id: tpl.other } }))
          .authorId
      ).toBe(m2.id)
    })
  })

  describe("a repeated id field is refused, not split between check and write", () => {
    it("saveTemplate: an own id first cannot carry the write to another template", async () => {
      for (const ids of [
        [tpl.own, tpl.super],
        [tpl.own, tpl.other],
        [tpl.super, tpl.own],
      ]) {
        const r = await saveTemplate(
          null,
          form({ id: ids, name: "Взлом", kind: "text", text: "x" })
        )
        expect(r.error).toBeTruthy()
      }
      expect(await db.template.count({ where: { name: "Взлом" } })).toBe(0)
    })

    it.each([
      [
        "deleteTemplate",
        () => deleteTemplate(null, form({ id: [tpl.own, tpl.super] })),
      ],
      [
        "deleteSchedule",
        () => deleteSchedule(form({ id: [sch.own, sch.super] })),
      ],
      [
        "bindChats",
        () => bindChats(form({ id: [sch.own, sch.other], chatId: [chat.c1] })),
      ],
      [
        "bindChat",
        () =>
          bindChat(form({ chatId: [chat.c1, chat.c2], scheduleId: sch.own })),
      ],
      [
        "bindChat schedule",
        () =>
          bindChat(form({ chatId: chat.c1, scheduleId: [sch.own, sch.other] })),
      ],
      [
        "saveSchedule",
        () =>
          saveSchedule(
            null,
            form({
              id: [sch.own, sch.super],
              name: "x",
              templateId: tpl.own,
              time: "09:00",
              startDate: "2030-01-01",
              period: "day",
            })
          ),
      ],
      [
        "saveSchedule chat",
        () =>
          saveSchedule(
            null,
            form({
              id: sch.super,
              chatId: [chat.c1, chat.c2],
              scope: "this",
              name: "x",
              templateId: tpl.own,
              time: "09:00",
              startDate: "2030-01-01",
              period: "day",
            })
          ),
      ],
      [
        "renameChat",
        () => renameChat(form({ id: [chat.c1, chat.c2], title: "Взлом" })),
      ],
      [
        "sendNow",
        () =>
          sendNow(
            null,
            form({ chatIds: chat.c1, templateId: [tpl.super, tpl.other] })
          ),
      ],
    ])("%s", async (_, call) => {
      expect((await call()).error).toBeTruthy()
      expect(await db.template.count()).toBe(4)
      expect(await db.schedule.count()).toBe(4)
      expect(await db.outbox.count()).toBe(0)
      expect(await db.chat.count({ where: { title: "Взлом" } })).toBe(0)
      expect(
        await db.chat.count({ where: { scheduleId: { not: null } } })
      ).toBe(0)
    })

    it("superadmin actions too", async () => {
      as("acc-root")
      expect(
        (await deleteChat(form({ id: [chat.c1, chat.c2] }))).error
      ).toBeTruthy()
      expect(
        (
          await assignManagers(
            form({ id: [chat.c3, chat.c1], managerId: m1.id })
          )
        ).error
      ).toBeTruthy()
      expect(await db.chat.count({ where: { deleting: true } })).toBe(0)
      expect(await db.chat.count({ where: visibleChats(m1) })).toBe(1)
    })
  })

  describe("send now", () => {
    const send = (chatIds: number[], templateId: number) =>
      sendNow(null, form({ chatIds, templateId }))

    it("goes to assigned chats with visible templates only", async () => {
      expect((await send([chat.c1, chat.c2], tpl.super)).error).toBeTruthy()
      expect((await send([chat.c1], tpl.other)).error).toBeTruthy()
      expect(await db.outbox.count()).toBe(0)
      expect((await send([chat.c1], tpl.super)).error).toBeUndefined()
      expect(await db.outbox.count()).toBe(1)
    })
  })
})
