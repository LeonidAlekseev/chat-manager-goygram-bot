import { mkdirSync } from "node:fs"

import { expect, test } from "@playwright/test"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

import type { Page } from "@playwright/test"

import { LOGIN, PASSWORD } from "../playwright.config"

const SHOTS = "/tmp/shots118"
mkdirSync(SHOTS, { recursive: true })
test.use({ viewport: { width: 390, height: 844 } })

const db = new PrismaClient()
test.afterAll(() => db.$disconnect())

async function signIn(page: Page, l: string, p: string) {
  await page.goto("/login")
  await page.getByLabel("Логин").fill(l)
  await page.getByLabel("Пароль").fill(p)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")
}

// a manager who sees the superadmin's schedule and template, and one assigned chat (no public username) bound to it
async function world(tag: number) {
  const m = await db.manager.create({
    data: {
      login: `e2e-d-${tag}`,
      name: `D ${tag}`,
      passwordHash: await bcrypt.hash("pw-d-test", 4),
    },
  })
  const tpl = await db.template.create({
    data: { name: `Шаблон ${tag}`, kind: "text", text: "x" },
  })
  const sch = await db.schedule.create({
    data: {
      name: `Расписание ${tag}`,
      items: {
        create: {
          templateId: tpl.id,
          time: "08:00",
          period: "day",
          startDate: new Date("2026-01-01"),
        },
      },
    },
  })
  const chat = await db.chat.create({
    data: {
      telegramId: BigInt(-880000000 - (tag % 1e6)),
      title: `Чат ${tag}`,
      scheduleId: sch.id,
      managers: { create: { managerId: m.id } },
    },
  })
  const clean = async () => {
    await db.chat.deleteMany({ where: { id: chat.id } })
    await db.schedule.deleteMany({
      where: { OR: [{ id: sch.id }, { authorId: m.id }] },
    })
    await db.template.deleteMany({
      where: { OR: [{ id: tpl.id }, { authorId: m.id }] },
    })
    await db.manager.deleteMany({ where: { id: m.id } })
  }
  return { m, tpl, sch, chat, clean }
}

test("no public username: no empty space for the Telegram button (#118.1)", async ({
  page,
}) => {
  const w = await world(Date.now())
  try {
    await signIn(page, w.m.login, "pw-d-test")
    const card = page.locator("li", { hasText: w.chat.title })
    await expect(card.getByText("Открыть в Telegram")).toHaveCount(0)
    await expect(card.locator(".border-t")).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/chats.png` })
    await page.goto(`/chats/${w.chat.id}`)
    await expect(page.getByText("Открыть в Telegram")).toHaveCount(0)
    // the header's button row is not rendered at all, so it leaves no gap
    await expect(
      page.locator("main div.flex-wrap.items-center.gap-2:empty")
    ).toHaveCount(0)
    // #118.3: the foreign schedule is marked on the chat page too
    await expect(page.getByText("Неизменяемый")).toBeVisible()
  } finally {
    await w.clean()
  }
})

test("read-only schedule: every field looks disabled; «Дублировать» makes an editable copy (#118.2, .3)", async ({
  page,
}) => {
  const w = await world(Date.now())
  try {
    await signIn(page, w.m.login, "pw-d-test")
    await page.goto("/schedules")
    const card = page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: w.sch.name }) })
    await card.locator("summary").click()
    const form = card.locator("form").first()
    const looks = (sel: string) =>
      form.locator(sel).evaluate((e) => ({
        disabled: e.matches(":disabled"),
        opacity: getComputedStyle(e).opacity,
      }))
    const date = await looks("input[name=startDate]")
    expect(date.disabled).toBe(true)
    for (const sel of [
      "select[name=templateId]",
      "select[name=period]",
      "input[name=time]",
    ])
      expect(await looks(sel)).toEqual(date)
    await page.screenshot({ path: `${SHOTS}/schedules-readonly.png` })

    await card.getByRole("button", { name: /Дублировать/ }).click()
    const copy = page.locator("details", {
      hasText: `${w.sch.name} (копия)`,
    })
    await expect(copy).toBeVisible()
    await expect(copy.getByText("Неизменяемый")).toHaveCount(0)
    await copy.locator("summary").click()
    await expect(copy.locator("select[name=templateId]")).toBeEnabled()
    await expect(
      copy.getByRole("button", { name: "Сохранить", exact: true })
    ).toBeVisible()
    expect(
      await db.chat.count({
        where: { schedule: { name: `${w.sch.name} (копия)` } },
      })
    ).toBe(0)
  } finally {
    await w.clean()
  }
})

test("read-only template: fields disabled, no save; «Дублировать» gives the manager a copy (#118.4)", async ({
  page,
}) => {
  const w = await world(Date.now())
  try {
    await signIn(page, w.m.login, "pw-d-test")
    await page.goto("/templates")
    const card = page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: w.tpl.name }) })
    await card.locator("summary").click()
    await expect(card.locator("input[name=name]")).toBeDisabled()
    await expect(card.locator("textarea[name=text]")).toBeDisabled()
    await expect(card.locator("select[name=kind]")).toBeDisabled()
    await expect(card.locator("input[name=mentionAll]")).toBeDisabled()
    await expect(card.getByRole("button", { name: "Сохранить" })).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/templates-readonly.png` })

    await card.getByRole("button", { name: /Дублировать/ }).click()
    const copy = page.locator("details", { hasText: `${w.tpl.name} (копия)` })
    await expect(copy).toBeVisible()
    await copy.locator("summary").click()
    await expect(copy.getByText("Неизменяемый")).toHaveCount(0)
    await expect(copy.locator("input[name=name]")).toBeEnabled()
    await expect(copy.getByRole("button", { name: "Сохранить" })).toBeVisible()
  } finally {
    await w.clean()
  }
})

test("a new item starts on «Не выбран»; adding and saving wait for a choice (#118.5)", async ({
  page,
}) => {
  const w = await world(Date.now())
  try {
    await signIn(page, w.m.login, "pw-d-test")
    await page.goto("/schedules")
    const form = page.locator("form").first()
    const select = form.locator("select[name=templateId]")
    await expect(select).toHaveValue("")
    await expect(select.locator("option:checked")).toHaveText("Не выбран")
    await expect(form.getByRole("button", { name: "Создать" })).toBeDisabled()
    await expect(
      form.getByRole("button", { name: "Добавить шаблон" })
    ).toBeDisabled()
    await select.selectOption({ label: w.tpl.name })
    await expect(form.getByRole("button", { name: "Создать" })).toBeEnabled()
    await form.getByRole("button", { name: "Добавить шаблон" }).click()
    await expect(form.getByRole("button", { name: "Создать" })).toBeDisabled()
  } finally {
    await w.clean()
  }
})

test("no stray line breaks or sideways scroll on any page at 360, 390, 1280 (#118.6)", async ({
  page,
}) => {
  const w = await world(Date.now())
  try {
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 })
      await signIn(page, LOGIN, PASSWORD)
      for (const path of [
        "/chats",
        `/chats/${w.chat.id}`,
        "/templates",
        "/schedules",
        "/send",
        "/logs",
        "/managers",
        "/profile",
        "/settings",
      ]) {
        await page.goto(path)
        await page.evaluate(() =>
          document.querySelectorAll("details").forEach((d) => (d.open = true))
        )
        const r = await page.evaluate(() => {
          const wrapped: string[] = []
          const tw = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT
          )
          for (let n; (n = tw.nextNode()); ) {
            const txt = (n.textContent ?? "").trim()
            const el = n.parentElement
            if (
              txt.length < 3 ||
              txt.length > 32 ||
              /\d{9,}/.test(txt) || // timestamped rows other tests leave behind
              !el ||
              el.closest("textarea,option,select,script,style") ||
              el.offsetParent === null
            )
              continue
            const rg = document.createRange()
            rg.selectNodeContents(n)
            const tops = [...rg.getClientRects()]
              .filter((q) => q.width > 0)
              .map((q) => q.top)
            if (tops.length && Math.max(...tops) - Math.min(...tops) > 8)
              wrapped.push(txt)
          }
          return {
            wrapped,
            wide: document.documentElement.scrollWidth > window.innerWidth,
          }
        })
        expect(r, `${path} @${width}`).toEqual({ wrapped: [], wide: false })
      }
      await page.goto("/send")
      if (width === 390) await page.screenshot({ path: `${SHOTS}/send.png` })
      const h = await page
        .locator("legend", { hasText: /^Чаты · / })
        .evaluate((e) => ({
          box: e.getBoundingClientRect().height,
          line: parseFloat(getComputedStyle(e).lineHeight),
        }))
      expect(h.box).toBeLessThanOrEqual(h.line + 1)
      await page.context().clearCookies()
    }
  } finally {
    await w.clean()
  }
})
