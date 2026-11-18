import {
  deleteTemplate,
  saveTemplate,
} from "@/app/(dashboard-layout)/templates/actions"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/lib/db"

const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("@/auth", () => ({ auth: async () => session.current }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

function form(fields: Record<string, string | string[]>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x)
  return f
}

const poll = {
  name: "Смена открыта?",
  kind: "poll",
  text: "Смена открыта?",
  options: "Да\nНет",
}

describe("templates", () => {
  beforeEach(async () => {
    await db.scheduleItem.deleteMany()
    await db.schedule.deleteMany()
    await db.template.deleteMany()
    session.current = { user: { name: "boss" } }
  })

  it("creates a non-anonymous poll by default-off flags", async () => {
    const r = await saveTemplate(null, form({ ...poll, multiple: "on" }))
    expect(r.error).toBeUndefined()
    const t = await db.template.findFirstOrThrow()
    expect(t).toMatchObject({
      kind: "poll",
      options: ["Да", "Нет"],
      anonymous: false,
      multiple: true,
      mentionAll: false,
    })
  })

  it("creates a text template and drops options", async () => {
    await saveTemplate(
      null,
      form({
        name: "Привет",
        kind: "text",
        text: "Всем привет",
        options: "x\ny",
        mentionAll: "on",
      })
    )
    expect(await db.template.findFirstOrThrow()).toMatchObject({
      kind: "text",
      options: [],
      mentionAll: true,
    })
  })

  it("edits an existing template", async () => {
    await saveTemplate(null, form(poll))
    const t = await db.template.findFirstOrThrow()
    await saveTemplate(
      null,
      form({ ...poll, id: String(t.id), options: "А\nБ\nВ", anonymous: "on" })
    )
    expect(
      await db.template.findUniqueOrThrow({ where: { id: t.id } })
    ).toMatchObject({
      options: ["А", "Б", "В"],
      anonymous: true,
    })
  })

  it.each([
    ["options", { options: "Б\nА\nВ" }],
    ["multiple answers", { options: "А\nБ\nВ", multiple: "on" }],
    ["kind", { kind: "text", text: "x" }],
  ])("refuses to change a quiz's %s", async (_, change) => {
    const t = await db.template.create({
      data: {
        ...poll,
        kind: "poll",
        options: ["А", "Б", "В"],
        correctOptionId: 2,
      },
    })
    const edit = form({ ...poll, id: String(t.id), ...change })
    expect((await saveTemplate(null, edit)).error).toMatch(/викторин/i)
    const ok = form({
      ...poll,
      id: String(t.id),
      name: "Новое",
      options: "А\nБ\nВ",
    })
    expect((await saveTemplate(null, ok)).error).toBeUndefined()
    expect(
      await db.template.findUniqueOrThrow({ where: { id: t.id } })
    ).toMatchObject({
      name: "Новое",
      options: ["А", "Б", "В"],
      multiple: false,
      correctOptionId: 2,
    })
  })

  it.each([
    ["one option", { options: "Да" }],
    [
      "eleven options",
      { options: Array.from({ length: 11 }, (_, i) => `o${i}`).join("\n") },
    ],
    ["option over 100 chars", { options: `Да\n${"x".repeat(101)}` }],
    ["question over 300 chars", { text: "x".repeat(301) }],
    ["empty name", { name: "  " }],
  ])("rejects a poll with %s", async (_, over) => {
    const r = await saveTemplate(null, form({ ...poll, ...over }))
    expect(r.error).toBeTruthy()
    expect(await db.template.count()).toBe(0)
  })

  it("rejects a text over 4096 chars", async () => {
    const r = await saveTemplate(
      null,
      form({ name: "t", kind: "text", text: "x".repeat(4097) })
    )
    expect(r.error).toBeTruthy()
  })

  it("edits only the name and mention-all of a copy template", async () => {
    const t = await db.template.create({
      data: {
        name: "Ключ",
        kind: "copy",
        text: "превью",
        sourceChatId: 42,
        sourceMessageIds: [7],
        mediaType: "photo",
      },
    })
    const r = await saveTemplate(
      null,
      form({
        id: String(t.id),
        name: "Новое имя",
        kind: "text",
        text: "подмена",
        mentionAll: "on",
      })
    )
    expect(r.error).toBeUndefined()
    expect(
      await db.template.findUniqueOrThrow({ where: { id: t.id } })
    ).toMatchObject({
      name: "Новое имя",
      mentionAll: true,
      kind: "copy",
      text: "превью",
      sourceMessageIds: [BigInt(7)],
    })
  })

  it("does not create a copy template from the form", async () => {
    const r = await saveTemplate(
      null,
      form({ name: "x", kind: "copy", text: "x" })
    )
    expect(r.error).toBeTruthy()
    expect(await db.template.count()).toBe(0)
  })

  it("deletes an unused template", async () => {
    await saveTemplate(null, form(poll))
    const t = await db.template.findFirstOrThrow()
    expect(
      (await deleteTemplate(null, form({ id: String(t.id) }))).error
    ).toBeUndefined()
    expect(await db.template.count()).toBe(0)
  })

  it("refuses to delete a template used in a schedule", async () => {
    const t = await db.template.create({
      data: { name: "t", kind: "text", text: "x" },
    })
    await db.schedule.create({
      data: {
        name: "Смена 08:00",
        items: { create: { templateId: t.id, time: "08:00" } },
      },
    })
    const r = await deleteTemplate(null, form({ id: String(t.id) }))
    expect(r.error).toMatch(/расписани/)
    expect(await db.template.count()).toBe(1)
  })

  it("refuses when not signed in", async () => {
    session.current = null
    await expect(saveTemplate(null, form(poll))).rejects.toThrow("Unauthorized")
  })
})
