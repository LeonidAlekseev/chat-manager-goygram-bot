import { expect, test } from "@playwright/test"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

import type { Page } from "@playwright/test"

import { LOGIN, PASSWORD } from "../playwright.config"

const db = new PrismaClient()
test.afterAll(() => db.$disconnect())

async function openV3(page: Page, login: string, password: string) {
  await page.context().clearCookies()
  await page.goto("/login")
  await page.getByLabel("Логин").fill(login)
  await page.getByLabel("Пароль").fill(password)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")
  await page.goto("/v3")
  await expect(
    page.getByRole("heading", { name: "Рассылки в Telegram-чаты" })
  ).toBeVisible()
  for (const h of ["Чаты", "Шаблоны", "Расписания", "Журнал"])
    await expect(
      page.getByRole("heading", { name: h, exact: true })
    ).toBeVisible()
  // a showcase: nothing can be submitted
  await expect(
    page.getByRole("button", { name: "Отправить сообщение" })
  ).toBeDisabled()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test.use({ viewport: { width: 390, height: 844 } })

test("/v3 opens for the superadmin without horizontal overflow on a phone", async ({
  page,
}) => {
  await openV3(page, LOGIN, PASSWORD)
})

test("/v3 opens for a manager and shows only their chats", async ({ page }) => {
  const tag = Date.now()
  const m = await db.manager.create({
    data: {
      login: `e2e-v3-${tag}`,
      name: `Менеджер v3 ${tag}`,
      passwordHash: await bcrypt.hash("pw-v3-test", 4),
    },
  })
  const chat = await db.chat.create({
    data: {
      telegramId: -(800000000000 + (tag % 1e9)),
      title: `Чужой v3 ${tag}`,
    },
  })
  await openV3(page, m.login, "pw-v3-test")
  await expect(page.getByText(chat.title)).toHaveCount(0)
})
