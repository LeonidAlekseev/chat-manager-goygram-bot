import { expect, test } from "@playwright/test"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const db = new PrismaClient()
test.afterAll(() => db.$disconnect())

const PAGES = [
  "/",
  "/chats",
  "/chats/1",
  "/logs",
  "/logs/1",
  "/managers",
  "/profile",
  "/schedules",
  "/send",
  "/settings",
  "/system-logs",
  "/templates",
  "/no-such-page",
]

test("without a session every panel page is a 307 to /login before render", async ({
  request,
}) => {
  for (const path of PAGES)
    for (const headers of [{}, { RSC: "1" }] as Record<string, string>[]) {
      const res = await request.get(path, { headers, maxRedirects: 0 })
      expect(res.status(), `${path} ${JSON.stringify(headers)}`).toBe(307)
      expect(res.headers().location).toBe("/login")
    }
  const api = await request.get("/api/anything", { maxRedirects: 0 })
  expect(api.status()).toBe(401)
  expect((await request.get("/login", { maxRedirects: 0 })).status()).toBe(200)
  expect(
    (await request.get("/api/auth/session", { maxRedirects: 0 })).status()
  ).toBe(200)
})

test("a disabled manager is turned away by the middleware", async ({
  page,
}) => {
  const login = `e2e-mw-${Date.now()}`
  const m = await db.manager.create({
    data: { login, passwordHash: await bcrypt.hash("pw-mw-test", 4) },
  })
  await page.goto("/login")
  await page.getByLabel("Логин").fill(login)
  await page.getByLabel("Пароль").fill("pw-mw-test")
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")
  const ok = await page.request.get("/chats", { maxRedirects: 0 })
  expect(ok.status()).toBe(200)

  await db.manager.update({ where: { id: m.id }, data: { active: false } })
  const res = await page.request.get("/chats", { maxRedirects: 0 })
  expect(res.status()).toBe(307)
  expect(res.headers().location).toBe("/login")
})
