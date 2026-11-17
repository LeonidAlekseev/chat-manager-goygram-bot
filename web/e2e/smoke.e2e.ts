import { expect, test } from "@playwright/test"
import { PrismaClient } from "@prisma/client"

import { LOGIN, PASSWORD } from "../playwright.config"
import { CHAT } from "./global-setup"

const db = new PrismaClient()
test.afterAll(() => db.$disconnect())

test("login → create template → create schedule → bind chat", async ({
  page,
}) => {
  const name = `E2E ${Date.now()}`
  // Match the item's own summary: on a reused DB older schedules list this template in their <select>.
  const item = () =>
    page.locator("details").filter({
      has: page.locator("summary", { hasText: name }),
    })
  await page.goto("/login")
  await page.getByLabel("Логин").fill(LOGIN)
  await page.getByLabel("Пароль").fill(PASSWORD)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")

  await page.goto("/templates")
  const tpl = page.locator("form").first()
  await tpl.getByPlaceholder("Название").fill(name)
  await tpl.getByPlaceholder(/Вопрос опроса/).fill("Смена открыта?")
  await tpl.getByPlaceholder(/Варианты опроса/).fill("Да\nНет")
  await tpl.getByRole("button", { name: "Создать" }).click()
  await expect(page.locator("summary", { hasText: name })).toBeVisible()
  // The bot's «Открыть в панели» link opens the template it saved.
  const domId = await item().getAttribute("id")
  await page.goto(`/templates?id=${domId!.slice(2)}`)
  await expect(page.locator(`#${domId}`)).toHaveAttribute("open", "")

  await page.goto("/schedules")
  const sch = page.locator("form").first()
  await sch.getByPlaceholder("Название").fill(name)
  // a new schedule starts with one item row
  await sch.getByLabel("Шаблон").selectOption({ label: name })
  await sch.getByRole("button", { name: "Создать" }).click()

  const created = item()
  await created.locator("summary").click()
  await created.getByLabel(CHAT).check()
  await created.getByRole("button", { name: "Сохранить привязку" }).click()
  await expect(created.locator("summary")).toContainText("чатов: 1")
})

test("settings: bot status and the account login wizard", async ({ page }) => {
  await page.goto("/login")
  await page.getByLabel("Логин").fill(LOGIN)
  await page.getByLabel("Пароль").fill(PASSWORD)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")

  await page.goto("/settings")
  await expect(page.getByText(/Состояние бота: /)).toBeVisible()
  await page.getByLabel("API ID").fill("2040")
  await page.getByLabel("API HASH").fill("0123456789abcdef0123456789abcdef")
  await page.getByRole("button", { name: "Сохранить" }).click()
  await expect(page.getByText("Сохранено.")).toBeVisible()
  await page.getByLabel("Телефон аккаунта").fill("+79990001122")
  await page.getByRole("button", { name: "Получить код" }).click()
  // No bot runs in e2e: the step is never answered and the panel offers to start over.
  await expect(page.getByText("Бот не ответил.")).toBeVisible()
  await page.getByRole("button", { name: "Начать заново" }).click()
  await expect(page.getByRole("button", { name: "Получить код" })).toBeEnabled()
})

test("settings: disconnecting the Telegram account asks first", async ({
  page,
}) => {
  // The bot sets the account name after a login; no bot runs in e2e, so seed it.
  await db.settings.upsert({
    where: { id: 1 },
    create: { id: 1, apiAccount: "E2E (@e2e)" },
    update: { apiAccount: "E2E (@e2e)" },
  })
  await page.goto("/login")
  await page.getByLabel("Логин").fill(LOGIN)
  await page.getByLabel("Пароль").fill(PASSWORD)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")

  try {
    await page.goto("/settings")
    await expect(page.getByText("Вход выполнен: E2E (@e2e)")).toBeVisible()
    const disconnect = page.getByRole("button", {
      name: "Отключить аккаунт Telegram",
    })

    // Cancel: nothing is sent to the bot.
    let question = ""
    page.once("dialog", (d) => {
      question = d.message()
      void d.dismiss()
    })
    await disconnect.click()
    expect(question).toContain("Сессия Telegram будет завершена")
    await expect(page.getByText("Бот выполняет шаг…")).toBeHidden()
    expect(await db.mtprotoLogin.count()).toBe(0)

    // Confirm: the logout step goes to the bot.
    page.once("dialog", (d) => void d.accept())
    await disconnect.click()
    // No bot runs in e2e, so the panel shows «Бот не ответил.»; the step itself is what matters.
    await expect
      .poll(
        async () =>
          (await db.mtprotoLogin.findUnique({ where: { id: 1 } }))?.step
      )
      .toBe("logout")
  } finally {
    await db.mtprotoLogin.deleteMany()
    await db.settings.updateMany({
      data: { apiAccount: null, apiSession: null },
    })
  }
})
