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
