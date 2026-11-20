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

test("a manager sees neither another manager's template nor an unassigned chat until the superadmin assigns it", async ({
  page,
}) => {
  const tag = Date.now()
  const passwordHash = await bcrypt.hash("pw-scope-test", 4)
  const [m1, m2] = await Promise.all(
    ["a", "b"].map((x) =>
      db.manager.create({
        data: {
          login: `e2e-scope-${x}-${tag}`,
          name: `Менеджер ${x} ${tag}`,
          passwordHash,
        },
      })
    )
  )
  await db.template.create({
    data: { name: `Чужой ${tag}`, kind: "text", text: "x", authorId: m2.id },
  })
  const chat = await db.chat.create({
    data: { telegramId: -(900000000000 + (tag % 1e9)), title: `Чат ${tag}` },
  })

  await signIn(page, m1.login, "pw-scope-test")
  await expect(page.getByLabel(`Название чата ${chat.telegramId}`)).toHaveCount(
    0
  )
  // the group scan is the superadmin's
  await expect(page.getByText("Добавьте бота в группу")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Найти группы бота" })
  ).toHaveCount(0)
  // notFound() streams in a 200 response, so check what is rendered
  await page.goto(`/chats/${chat.id}`)
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible()
  await expect(page.getByText(`Чат ${tag}`)).toHaveCount(0)
  await page.goto("/templates")
  await expect(page.getByText(`Чужой ${tag}`)).toHaveCount(0)

  await signIn(page, LOGIN, PASSWORD)
  await expect(
    page.getByRole("button", { name: "Найти группы бота" })
  ).toBeVisible()
  await page.goto(`/chats/${chat.id}`)
  await page.getByLabel(`Менеджер a ${tag}`).check()
  await page.getByRole("button", { name: "Сохранить менеджеров" }).click()
  await expect
    .poll(() => db.chatManager.count({ where: { chatId: chat.id } }))
    .toBe(1)

  await signIn(page, m1.login, "pw-scope-test")
  await page.goto("/chats")
  await expect(
    page.getByLabel(`Название чата ${chat.telegramId}`)
  ).toBeVisible()
  // a manager cannot delete a chat: no trash button
  await expect(
    page.getByRole("button", { name: `Удалить чат «Чат ${tag}»` })
  ).toHaveCount(0)
})
