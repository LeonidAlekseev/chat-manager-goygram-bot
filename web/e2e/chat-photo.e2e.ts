import { expect, test } from "@playwright/test"
import { PrismaClient } from "@prisma/client"

import { LOGIN, PASSWORD } from "../playwright.config"
import { CHAT } from "./global-setup"

const db = new PrismaClient()
test.afterAll(() => db.$disconnect())

// 1×1 PNG: what the bot would have stored for a group with a photo (#113)
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
)
const telegramId = BigInt(-999000113)
const TITLE = "Группа с фото"

test("chat cards show the group's photo or its first letter", async ({
  page,
  request,
}) => {
  const chat = await db.chat.upsert({
    where: { telegramId },
    create: { telegramId, title: TITLE },
    update: { title: TITLE, active: true, deleting: false },
  })
  await db.chatPhoto.upsert({
    where: { chatId: chat.id },
    create: { chatId: chat.id, uniqueId: "e2e", mime: "image/png", data: PNG },
    update: { uniqueId: "e2e", mime: "image/png", data: PNG },
  })
  // the middleware stops an anonymous request before the route
  expect((await request.get(`/api/chats/${chat.id}/photo`)).status()).toBe(401)

  await page.goto("/login")
  await page.getByLabel("Логин").fill(LOGIN)
  await page.getByLabel("Пароль").fill(PASSWORD)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")

  const img = page.locator(`img[src="/api/chats/${chat.id}/photo?v=e2e"]`)
  await expect(img).toBeVisible()
  // loaded through the session: a broken image has naturalWidth 0
  await expect
    .poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBe(1)
  const plain = await db.chat.findUniqueOrThrow({
    where: { telegramId: BigInt(-999000001) },
  })
  await expect(
    page.getByLabel(`Название чата ${plain.telegramId}`)
  ).toHaveValue(CHAT)
  await expect(
    page
      .locator("form", {
        has: page.getByLabel(`Название чата ${plain.telegramId}`),
      })
      .locator("span[aria-hidden]")
  ).toHaveText(CHAT.slice(0, 1))
})
