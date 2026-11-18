import { expect, test } from "@playwright/test"

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
