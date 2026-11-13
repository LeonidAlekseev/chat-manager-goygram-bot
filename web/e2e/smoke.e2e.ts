import { expect, test } from "@playwright/test"

import { LOGIN, PASSWORD } from "../playwright.config"
import { CHAT } from "./global-setup"

test("login → create template → create schedule → bind chat", async ({
  page,
}) => {
  const name = `E2E ${Date.now()}`
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
  const domId = await page
    .locator("details", { hasText: name })
    .getAttribute("id")
  await page.goto(`/templates?id=${domId!.slice(2)}`)
  await expect(page.locator(`#${domId}`)).toHaveAttribute("open", "")

  await page.goto("/schedules")
  const sch = page.locator("form").first()
  await sch.getByPlaceholder("Название").fill(name)
  await sch.getByRole("button", { name: "Добавить пункт" }).click()
  await sch.getByLabel("Шаблон").selectOption({ label: name })
  await sch.getByRole("button", { name: "Создать" }).click()

  const created = page.locator("details", { hasText: name })
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
