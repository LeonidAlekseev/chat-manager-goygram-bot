import {
  loginStep,
  logout,
  restart,
} from "@/app/(dashboard-layout)/settings/actions"
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
      stuck: true, // no bot heartbeat in this test
      state: null,
      error: null,
      sent: null,
      resend: false,
    })
  })

  it.each([
    ["8 (999) 000-11-22", "+79990001122"],
    ["89990001122", "+79990001122"],
    ["+7 (999) 000-11-22", "+79990001122"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("normalizes the phone %s to %s", async (input, phone) => {
    await withApi()
    await loginStep(null, form({ step: "phone", value: input }))
    const row = await db.mtprotoLogin.findUniqueOrThrow({ where: { id: 1 } })
    expect(decrypt(row.input!)).toBe(phone)
  })

  it("asks the bot to send the code another way", async () => {
    await withApi()
    await db.mtprotoLogin.create({
      data: {
        state: "code",
        sent: "Код отправлен в чат «Telegram».",
        resend: true,
      },
    })
    expect(await loginStep(null, form({ step: "resend", value: "" }))).toEqual({
      saved: true,
    })
    const row = await db.mtprotoLogin.findUniqueOrThrow({ where: { id: 1 } })
    expect(row.step).toBe("resend")
    expect((await accountView()).login).toMatchObject({
      state: "code",
      sent: "Код отправлен в чат «Telegram».",
      resend: true,
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
    [{ step: "phone", value: "79990001122" }, /телефон/i], // no "+": the country code is a guess
    [{ step: "phone", value: "+7 999 abc" }, /телефон/i],
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
    await expect(restart()).rejects.toThrow("Forbidden")
  })

  it("logout asks the bot to end the session in Telegram", async () => {
    await db.settings.create({
      data: { apiSession: encrypt("{}"), apiAccount: "Анна (@anna)" },
    })
    await logout()
    const row = await db.mtprotoLogin.findUniqueOrThrow({ where: { id: 1 } })
    expect(row.step).toBe("logout")
    expect(row.input).not.toBeNull() // the bot takes only a step with input
    const view = await accountView()
    expect(view.account).toBe("Анна (@anna)") // the bot wipes it after auth.logOut
    expect(view.login.pending).toBe(true)
  })

  it("«Начать заново» erases the session and the wizard in the panel", async () => {
    await db.settings.create({
      data: { apiSession: encrypt("{}"), apiAccount: "Анна (@anna)" },
    })
    await db.mtprotoLogin.create({ data: { step: "logout", input: "x" } })
    await restart()
    const s = await db.settings.findUniqueOrThrow({ where: { id: 1 } })
    expect([s.apiSession, s.apiAccount]).toEqual([null, null])
    expect(await db.mtprotoLogin.count()).toBe(0)
    expect((await accountView()).account).toBeNull()
  })

  it("refuses a new step while the bot has not answered the last one", async () => {
    await withApi()
    await db.mtprotoLogin.create({ data: { step: "phone", input: "x" } })
    const r = await loginStep(null, form({ step: "code", value: "12345" }))
    expect(r?.error).toMatch(/предыдущ/)
    await logout()
    const row = await db.mtprotoLogin.findUniqueOrThrow({ where: { id: 1 } })
    expect([row.step, row.input]).toEqual(["phone", "x"])
  })

  it.each([
    ["a fresh step, bot alive", 0, true, false],
    ["a step pending over 2 minutes", 3 * 60_000, true, true],
    ["a fresh step, bot silent", 0, false, true],
  ])("%s → stuck: %s", async (_, age, alive, stuck) => {
    await db.settings.create({
      data: { botSeenAt: alive ? new Date() : null },
    })
    await db.mtprotoLogin.create({
      data: { step: "code", input: "x", updatedAt: new Date(Date.now() - age) },
    })
    expect((await accountView()).login).toMatchObject({ pending: true, stuck })
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
