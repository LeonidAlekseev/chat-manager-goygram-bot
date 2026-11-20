import { expect, test } from "@playwright/test"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

import type { Page } from "@playwright/test"

import { LOGIN, PASSWORD } from "../playwright.config"

const db = new PrismaClient()
test.afterAll(() => db.$disconnect())

async function signIn(page: Page, login: string, password: string) {
  await page.context().clearCookies()
  await page.goto("/login")
  await page.getByLabel("Логин").fill(login)
  await page.getByLabel("Пароль").fill(password)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")
}

async function checkV1(page: Page) {
  for (const size of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size)
    await page.goto("/v1")
    for (const h of ["Чаты", "Шаблоны", "Расписания", "Журнал"])
      await expect(page.getByRole("heading", { name: h })).toBeVisible()
    // read-only mock: every button is inert
    await expect(page.locator("main button:enabled")).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      )
    ).toBeLessThanOrEqual(0)
  }
}

test("/v1 opens read-only for the superadmin and a manager, no horizontal overflow on a phone", async ({
  page,
}) => {
  const tag = Date.now()
  const passwordHash = await bcrypt.hash("pw-v1-test", 4)
  const [manager, other] = await Promise.all(
    ["a", "b"].map((x) =>
      db.manager.create({ data: { login: `e2e-v1-${x}-${tag}`, passwordHash } })
    )
  )
  // the same access rules as the panel: another manager's template is the superadmin's to see only
  await db.template.create({
    data: {
      name: `Чужой v1 ${tag}`,
      kind: "text",
      text: "x",
      authorId: other.id,
    },
  })

  await signIn(page, LOGIN, PASSWORD)
  await checkV1(page)
  await expect(
    page.locator("#templates").getByText(`Чужой v1 ${tag}`)
  ).toBeVisible()

  await signIn(page, manager.login, "pw-v1-test")
  await checkV1(page)
  await expect(page.getByText(`Чужой v1 ${tag}`)).toHaveCount(0)
})
