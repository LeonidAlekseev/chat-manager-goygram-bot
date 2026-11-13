import {
  createLinkCode,
  unlinkTelegram,
} from "@/app/(dashboard-layout)/profile/actions"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/lib/db"

const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("@/auth", () => ({ auth: async () => session.current }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

describe("telegram link", () => {
  beforeEach(async () => {
    await db.manager.deleteMany()
    await db.manager.create({
      data: { login: "m1", passwordHash: "x", telegramUserId: BigInt(5) },
    })
    session.current = { user: { name: "m1" } }
  })

  it("issues a code valid for 15 minutes and returns the /start command", async () => {
    const res = await createLinkCode(null, new FormData())
    const m = await db.manager.findUniqueOrThrow({ where: { login: "m1" } })
    expect(res.command).toBe(`/start link_${m.linkCode}`)
    const ttl = m.linkCodeExpiresAt!.getTime() - Date.now()
    expect(ttl).toBeGreaterThan(14 * 60_000)
    expect(ttl).toBeLessThanOrEqual(15 * 60_000)
  })

  it("a new code replaces the previous one", async () => {
    const a = await createLinkCode(null, new FormData())
    const b = await createLinkCode(null, new FormData())
    expect(a.command).not.toBe(b.command)
  })

  it("unlinks the account and drops a pending code", async () => {
    await createLinkCode(null, new FormData())
    await unlinkTelegram()
    const m = await db.manager.findUniqueOrThrow({ where: { login: "m1" } })
    expect(m.telegramUserId).toBeNull()
    expect(m.linkCode).toBeNull()
  })

  it("refuses when not signed in", async () => {
    session.current = null
    await expect(createLinkCode(null, new FormData())).rejects.toThrow(
      "Unauthorized"
    )
    await expect(unlinkTelegram()).rejects.toThrow("Unauthorized")
  })
})
