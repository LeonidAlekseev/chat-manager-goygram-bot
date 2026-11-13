import { saveSettings } from "@/app/(dashboard-layout)/settings/actions"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { decrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { settingsView } from "@/lib/settings"

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

const TOKEN = "123456789:AAH-abcdefghijklmnopqrstuvwxyz0123"
const HASH = "0123456789abcdef0123456789abcdef"
const full = { botToken: TOKEN, apiId: "2040", apiHash: HASH }

describe("settings", () => {
  beforeEach(async () => {
    await db.settings.deleteMany()
    asRole("superadmin")
  })

  it("starts empty", async () => {
    expect(await settingsView()).toEqual({
      botToken: null,
      apiId: null,
      apiHash: null,
      botUsername: null,
    })
  })

  it("superadmin saves; secrets are encrypted at rest and shown masked", async () => {
    expect(await saveSettings(null, form(full))).toEqual({ saved: true })
    const row = await db.settings.findUniqueOrThrow({ where: { id: 1 } })
    expect(row.botToken).not.toContain("AAH")
    expect(decrypt(row.botToken!)).toBe(TOKEN)
    expect(decrypt(row.apiHash!)).toBe(HASH)
    expect(await settingsView()).toEqual({
      botToken: "••••0123",
      apiId: 2040,
      apiHash: "••••cdef",
      botUsername: null,
    })
  })

  it("empty fields keep the stored values", async () => {
    await saveSettings(null, form(full))
    const NEW = "987654321:BBH-abcdefghijklmnopqrstuvwxyz9999"
    await saveSettings(null, form({ botToken: NEW, apiId: "", apiHash: "" }))
    expect(await settingsView()).toEqual({
      botToken: "••••9999",
      apiId: 2040,
      apiHash: "••••cdef",
      botUsername: null,
    })
  })

  it.each([
    [{ botToken: "not-a-token" }, /токен/i],
    [{ apiId: "abc" }, /API ID/],
    [{ apiHash: "xyz" }, /API HASH/],
  ])("reports invalid input %o", async (bad, message) => {
    const r = await saveSettings(null, form({ ...full, ...bad }))
    expect(r?.error).toMatch(message)
    expect(await db.settings.count()).toBe(0)
  })

  it.each([["manager"], [null]])("refuses %s", async (role) => {
    asRole(role)
    await expect(saveSettings(null, form(full))).rejects.toThrow("Forbidden")
    expect(await db.settings.count()).toBe(0)
  })

  it("shows the bot username written by the bot; saving API data keeps it", async () => {
    await db.settings.create({ data: { botUsername: "goy_manager_bot" } })
    await saveSettings(null, form({ ...full, botToken: "" }))
    expect((await settingsView()).botUsername).toBe("goy_manager_bot")
  })

  it("a new token forgets the old bot's username until the bot restarts", async () => {
    await db.settings.create({ data: { botUsername: "old_bot" } })
    await saveSettings(null, form({ ...full, apiId: "", apiHash: "" }))
    expect((await settingsView()).botUsername).toBeNull()
  })

  it("shows an undecryptable secret as such instead of failing the page", async () => {
    await db.settings.create({ data: { botToken: "garbage", apiId: 1 } })
    expect((await settingsView()).botToken).toBe("не расшифровывается")
  })
})
