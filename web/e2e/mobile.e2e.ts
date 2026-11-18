import { expect, test } from "@playwright/test"
import { PrismaClient } from "@prisma/client"

import type { Locator } from "@playwright/test"

import { LOGIN, PASSWORD } from "../playwright.config"
import { CHAT } from "./global-setup"

test.use({ viewport: { width: 390, height: 844 } })

test("mobile: no horizontal overflow, chat title visible, light only, OzonWaao", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" }) // the panel ignores the system theme
  await page.goto("/login")
  await page.getByLabel("Логин").fill(LOGIN)
  await page.getByLabel("Пароль").fill(PASSWORD)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")

  await expect(page.getByLabel(/Название чата/).first()).toBeVisible()
  await expect(page.locator(`input[value="${CHAT}"]`)).toBeVisible()
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  ).toBe("rgb(255, 255, 255)")
  await expect(page.getByText("Qualiora")).toHaveCount(0)

  for (const path of [
    "/chats",
    "/templates",
    "/schedules",
    "/logs",
    "/send",
    "/managers",
    "/profile",
    "/settings",
  ]) {
    await page.goto(path)
    await expect(page).toHaveTitle(/OzonWaao/)
    // body's overflow-x-hidden would mask a real overflow: measure without it
    await page.addStyleTag({ content: "body{overflow-x:visible!important}" })
    await page.evaluate(() =>
      document.querySelectorAll("details").forEach((d) => (d.open = true))
    )
    const [scroll, inner] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ])
    expect(scroll, `${path} overflows`).toBeLessThanOrEqual(inner)
  }
})

test("mobile: delete buttons fit the screen; deleting a chat hands it to the bot", async ({
  page,
}) => {
  const db = new PrismaClient()
  const name = `E2E del ${Date.now()}`
  const chat = await db.chat.create({
    data: { telegramId: BigInt(-Date.now()), title: name },
  })
  const tpl = await db.template.create({
    data: { name, kind: "text", text: "x" },
  })
  const sch = await db.schedule.create({ data: { name } })
  try {
    await page.goto("/login")
    await page.getByLabel("Логин").fill(LOGIN)
    await page.getByLabel("Пароль").fill(PASSWORD)
    await page.getByRole("button", { name: "Войти" }).click()
    await page.waitForURL("**/chats")

    const fits = async (button: Locator) => {
      await button.scrollIntoViewIfNeeded()
      await expect(button).toBeVisible()
      const box = (await button.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
    }
    for (const path of ["/templates", "/schedules"]) {
      await page.goto(path)
      const item = page.locator("details").filter({
        has: page.locator("summary", { hasText: name }),
      })
      await fits(item.getByRole("button", { name: "Удалить" })) // closed block
    }
    await page.goto("/chats")
    const row = page.locator("div.border-t").filter({
      has: page.locator(`input[value="${name}"]`),
    })
    await fits(row.getByRole("button", { name: "Удалить" }))
    page.once("dialog", (d) => {
      expect(d.message()).toContain(`«${name}»`)
      void d.accept()
    })
    await row.getByRole("button", { name: "Удалить" }).click()
    await expect(row.getByText("Удаляется…")).toBeVisible()
    await expect(row.getByRole("button", { name: "Удалить" })).toHaveCount(0)
    expect(
      (await db.chat.findUniqueOrThrow({ where: { id: chat.id } })).deleting
    ).toBe(true)
  } finally {
    await db.chat.deleteMany({ where: { id: chat.id } })
    await db.schedule.deleteMany({ where: { id: sch.id } })
    await db.template.deleteMany({ where: { id: tpl.id } })
    await db.$disconnect()
  }
})
