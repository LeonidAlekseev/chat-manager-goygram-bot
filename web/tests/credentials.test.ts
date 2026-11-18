import { beforeEach, describe, expect, it } from "vitest"

import { ensureSuperadmin, verifyCredentials } from "@/lib/credentials"
import { db } from "@/lib/db"

describe("superadmin login from env", () => {
  beforeEach(async () => {
    await db.manager.deleteMany()
  })

  it("lets the env superadmin sign in and rejects a wrong password", async () => {
    await ensureSuperadmin({
      SUPERADMIN_LOGIN: "root",
      SUPERADMIN_PASSWORD: "s3cret-pass",
    })
    expect(await verifyCredentials("root", "s3cret-pass")).toEqual({
      id: expect.any(Number),
      login: "root",
      role: "superadmin",
    })
    expect(await verifyCredentials("root", "wrong")).toBeNull()
    expect(await verifyCredentials("nobody", "s3cret-pass")).toBeNull()
  })

  it("stores only a hash of the password", async () => {
    await ensureSuperadmin({
      SUPERADMIN_LOGIN: "root",
      SUPERADMIN_PASSWORD: "s3cret-pass",
    })
    const row = await db.manager.findUniqueOrThrow({ where: { login: "root" } })
    expect(row.passwordHash).not.toContain("s3cret-pass")
  })

  it("picks up a changed env password on restart", async () => {
    await ensureSuperadmin({
      SUPERADMIN_LOGIN: "root",
      SUPERADMIN_PASSWORD: "old-pass",
    })
    await ensureSuperadmin({
      SUPERADMIN_LOGIN: "root",
      SUPERADMIN_PASSWORD: "new-pass",
    })
    expect(await verifyCredentials("root", "old-pass")).toBeNull()
    expect(await verifyCredentials("root", "new-pass")).not.toBeNull()
  })

  it("re-enables a superadmin disabled in the DB on restart", async () => {
    const env = { SUPERADMIN_LOGIN: "root", SUPERADMIN_PASSWORD: "s3cret-pass" }
    await ensureSuperadmin(env)
    await db.manager.update({
      where: { login: "root" },
      data: { active: false },
    })
    await ensureSuperadmin(env)
    expect(await verifyCredentials("root", "s3cret-pass")).not.toBeNull()
  })

  it("disables the old superadmin after SUPERADMIN_LOGIN changes", async () => {
    await ensureSuperadmin({
      SUPERADMIN_LOGIN: "root",
      SUPERADMIN_PASSWORD: "s3cret-pass",
    })
    await ensureSuperadmin({
      SUPERADMIN_LOGIN: "boss",
      SUPERADMIN_PASSWORD: "s3cret-pass",
    })
    expect(await verifyCredentials("root", "s3cret-pass")).toBeNull()
    expect(await verifyCredentials("boss", "s3cret-pass")).not.toBeNull()
  })

  it("refuses a password over bcrypt's 72 bytes", async () => {
    await expect(
      ensureSuperadmin({
        SUPERADMIN_LOGIN: "root",
        SUPERADMIN_PASSWORD: "ж".repeat(37),
      })
    ).rejects.toThrow("72")
  })

  it("refuses to start without superadmin env", async () => {
    await expect(ensureSuperadmin({})).rejects.toThrow("SUPERADMIN_LOGIN")
  })

  it("rejects a deactivated account", async () => {
    await ensureSuperadmin({
      SUPERADMIN_LOGIN: "root",
      SUPERADMIN_PASSWORD: "s3cret-pass",
    })
    await db.manager.update({
      where: { login: "root" },
      data: { active: false },
    })
    expect(await verifyCredentials("root", "s3cret-pass")).toBeNull()
  })
})
