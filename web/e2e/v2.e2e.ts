import { expect, test } from "@playwright/test"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

import type { Page } from "@playwright/test"

import { LOGIN, PASSWORD } from "../playwright.config"
import { CHAT } from "./global-setup"

const db = new PrismaClient()
test.afterAll(() => db.$disconnect())

const TABS = ["Чаты", "Шаблоны", "Расписания", "Отправка", "Журнал"]

async function signIn(page: Page, login: string, password: string) {
  await page.context().clearCookies()
  await page.goto("/login")
  await page.getByLabel("Логин").fill(login)
  await page.getByLabel("Пароль").fill(password)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")
}

// every tab opens on a phone without sideways scrolling
async function walkTabs(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/v2")
  for (const name of TABS) {
    await page
      .getByRole("navigation", { name: "Разделы" })
      .getByRole("link", { name })
      .click()
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      )
    ).toBeLessThanOrEqual(0)
  }
}

test("/v2 opens for the superadmin and a manager, scoped and without overflow on a phone", async ({
  page,
}) => {
  const tag = Date.now()
  const manager = await db.manager.create({
    data: {
      login: `e2e-v2-${tag}`,
      name: `Менеджер v2 ${tag}`,
      passwordHash: await bcrypt.hash("pw-v2-test", 4),
    },
  })

  await signIn(page, LOGIN, PASSWORD)
  await walkTabs(page)
  await page.goto("/v2?tab=chats")
  await expect(page.getByText(CHAT, { exact: true })).toBeVisible()

  // a manager sees only assigned chats: none here
  await signIn(page, manager.login, "pw-v2-test")
  await walkTabs(page)
  await page.goto("/v2?tab=chats")
  await expect(page.getByText("Добавьте бота в группу")).toBeVisible()
  await expect(page.getByTestId("v2-chat")).toHaveCount(0)
})
