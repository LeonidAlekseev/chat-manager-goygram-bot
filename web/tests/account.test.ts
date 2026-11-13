import { loginStep, logout } from "@/app/(dashboard-layout)/settings/actions"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { decrypt, encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { accountView } from "@/lib/settings"

const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("@/auth", () => ({ auth: async () => session.current }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

const asRole = (role: string | null) =>
  (session.current = role && { user: { name: "u", role } })

function form(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

const withApi = () =>
  db.settings.create({ data: { apiId: 2040, apiHash: encrypt("hash") } })

describe("MTProto login in the panel", () => {
  beforeEach(async () => {
    await db.settings.deleteMany()
    await db.mtprotoLogin.deleteMany()
    asRole("superadmin")
  })

  it("asks the bot for a step with the input encrypted", async () => {
    await withApi()
    expect(
      await loginStep(null, form({ step: "phone", value: "+7 999 000-11-22" }))
    ).toEqual({ saved: true })
    const row = await db.mtprotoLogin.findUniqueOrThrow({ where: { id: 1 } })
    expect(row.step).toBe("phone")
    expect(row.input).not.toContain("999")
    expect(decrypt(row.input!)).toBe("+79990001122")
    expect((await accountView()).login).toEqual({
      pending: true,
      state: null,
      error: null,
    })
  })

  it("a new step clears the bot's last error but keeps what it waits for", async () => {
    await withApi()
    await db.mtprotoLogin.create({
      data: { state: "code", error: "Неверный код." },
    })
    await loginStep(null, form({ step: "code", value: " 12345 " }))
    const row = await db.mtprotoLogin.findUniqueOrThrow({ where: { id: 1 } })
    expect([row.step, decrypt(row.input!), row.state, row.error]).toEqual([
      "code",
      "12345",
      "code",
      null,
    ])
  })

  it.each([
    [{ step: "phone", value: "12" }, /телефон/i],
    [{ step: "code", value: "" }, /код/i],
    [{ step: "password", value: "" }, /пароль/i],
  ])("reports invalid input %o", async (bad, message) => {
    await withApi()
    expect((await loginStep(null, form(bad)))?.error).toMatch(message)
    expect(await db.mtprotoLogin.count()).toBe(0)
  })

  it("needs API ID and API HASH first", async () => {
    const r = await loginStep(
      null,
      form({ step: "phone", value: "+79990001122" })
    )
    expect(r?.error).toMatch(/API ID/)
    expect(await db.mtprotoLogin.count()).toBe(0)
  })

  it("rejects an unknown step", async () => {
    await withApi()
    const r = await loginStep(null, form({ step: "logout", value: "x" }))
    expect(r?.error).toBeTruthy()
    expect(await db.mtprotoLogin.count()).toBe(0)
  })

  it.each([["manager"], [null]])("refuses %s", async (role) => {
    await withApi()
    asRole(role)
    await expect(
      loginStep(null, form({ step: "phone", value: "+79990001122" }))
    ).rejects.toThrow("Forbidden")
    await expect(logout()).rejects.toThrow("Forbidden")
  })

  it("logout erases the session and the wizard", async () => {
    await db.settings.create({
      data: { apiSession: encrypt("{}"), apiAccount: "Анна (@anna)" },
    })
    await db.mtprotoLogin.create({ data: { state: "password" } })
    await logout()
    const s = await db.settings.findUniqueOrThrow({ where: { id: 1 } })
    expect([s.apiSession, s.apiAccount]).toEqual([null, null])
    expect(await db.mtprotoLogin.count()).toBe(0)
    expect((await accountView()).account).toBeNull()
  })

  it("shows the account the bot logged in", async () => {
    await db.settings.create({ data: { apiAccount: "Анна (@anna)" } })
    expect((await accountView()).account).toBe("Анна (@anna)")
  })
})

describe("bot status", () => {
  beforeEach(() => db.settings.deleteMany())

  it.each([
    [{}, "не запущен"],
    [{ botSeenAt: new Date() }, "работает"],
    [{ botSeenAt: new Date(Date.now() - 5 * 60_000) }, "не запущен"],
    [
      { botSeenAt: new Date(), botError: "getMe: Unauthorized" },
      "ошибка: getMe: Unauthorized",
    ],
  ])("%o → %s", async (data, status) => {
    await db.settings.create({ data })
    expect((await accountView()).bot).toBe(status)
  })

  it("no settings row: not started", async () => {
    expect((await accountView()).bot).toBe("не запущен")
  })
})
