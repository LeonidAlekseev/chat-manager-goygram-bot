import { expect, test } from "@playwright/test"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

import type { Page } from "@playwright/test"

import { LOGIN, PASSWORD } from "../playwright.config"

test.use({ viewport: { width: 390, height: 844 } })

const db = new PrismaClient()
test.afterAll(() => db.$disconnect())

async function signIn(
  page: Page,
  l: string,
  p: string
) {
  await page.goto("/login")
  await page.getByLabel("Логин").fill(l)
  await page.getByLabel("Пароль").fill(p)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")
}

test("/send: «Что отправить» is one line at 360 and 390", async ({ page }) => {
  await signIn(page, LOGIN, PASSWORD)
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto("/send")
    const legend = page.locator("legend", { hasText: "Что отправить" })
    const h = await legend.evaluate((e) => ({
      box: e.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(e).lineHeight),
    }))
    expect(h.box).toBeLessThanOrEqual(h.line + 1)
  }
  await page.screenshot({ path: "/tmp/shots116/send.png" })
})

test("a manager sees the superadmin's schedule read-only on /schedules", async ({
  page,
}) => {
  const tag = Date.now()
  const m = await db.manager.create({
    data: {
      login: `e2e-ro-${tag}`,
      name: `RO ${tag}`,
      passwordHash: await bcrypt.hash("pw-ro-test", 4),
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
  try {
    await signIn(page, m.login, "pw-ro-test")
    await page.goto("/schedules")
    const card = page.locator("details", { hasText: `Расписание ${tag}` })
    await expect(card.getByText("Неизменяемый")).toBeVisible()
    await card.locator("summary").click()
    await expect(card.locator("select[name=templateId]")).toBeDisabled()
    await expect(card.getByText("только просмотр")).toBeVisible()
    await expect(
      card.getByRole("button", { name: /Удалить пункт/ })
    ).toHaveCount(0)
    await expect(
      card.getByRole("button", { name: "Добавить шаблон" })
    ).toHaveCount(0)
    await expect(
      card.getByRole("button", { name: "Сохранить", exact: true })
    ).toHaveCount(0)
    await page.screenshot({ path: "/tmp/shots116/schedules.png" })
  } finally {
    await db.schedule.deleteMany({ where: { id: sch.id } })
    await db.template.deleteMany({ where: { id: tpl.id } })
    await db.manager.deleteMany({ where: { id: m.id } })
  }
})

test("/templates: a poll card lists its options, a foreign one is «Неизменяемый»", async ({
  page,
}) => {
  const tag = Date.now()
  const m = await db.manager.create({
    data: {
      login: `e2e-tp-${tag}`,
      name: `TP ${tag}`,
      passwordHash: await bcrypt.hash("pw-tp-test", 4),
    },
  })
  const long = `Очень длинный вариант ответа без пробелов ${"ы".repeat(60)}`
  const t = await db.template.create({
    data: {
      name: `Опрос ${tag}`,
      kind: "poll",
      text: "Вопрос?",
      options: ["Да", long, "Нет"],
      correctOptionId: 0,
    },
  })
  try {
    await signIn(page, m.login, "pw-tp-test")
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto("/templates")
      const card = page.locator("details", { hasText: `Опрос ${tag}` })
      await expect(card.getByRole("listitem")).toHaveText([
        /^Да\s*верный$/,
        long,
        "Нет",
      ])
      await expect(card.getByText("Неизменяемый")).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true)
    }
    await page.locator("details", { hasText: `Опрос ${tag}` }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: "/tmp/shots116/templates.png" })
  } finally {
    await db.template.deleteMany({ where: { id: t.id } })
    await db.manager.deleteMany({ where: { id: m.id } })
  }
})
