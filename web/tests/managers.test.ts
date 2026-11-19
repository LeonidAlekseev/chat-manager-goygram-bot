import {
  createManager,
  setManagerActive,
  updateManager,
} from "@/app/(dashboard-layout)/managers/actions"
import bcrypt from "bcryptjs"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { activeSessionUser, verifyCredentials } from "@/lib/credentials"
import { db } from "@/lib/db"

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

const newManager = { login: "anna", name: "Анна", password: "longenough1" }

describe("managers CRUD", () => {
  beforeEach(async () => {
    // authors are RESTRICT: clear their rows first
    await db.scheduleItem.deleteMany()
    await db.schedule.deleteMany()
    await db.template.deleteMany()
    await db.manager.deleteMany()
    asRole("superadmin")
  })

  it("superadmin creates a manager who can sign in with a hashed password", async () => {
    await createManager(null, form(newManager))
    const m = await db.manager.findUniqueOrThrow({ where: { login: "anna" } })
    expect(m).toMatchObject({ name: "Анна", role: "manager", active: true })
    expect(m.passwordHash).not.toContain("longenough1")
    expect(await verifyCredentials("anna", "longenough1")).toMatchObject({
      login: "anna",
      role: "manager",
    })
  })

  it("limits the password by bytes: 37 Cyrillic letters are 74 bytes", async () => {
    const res = await createManager(
      null,
      form({ ...newManager, password: "ж".repeat(37) })
    )
    expect(res.error).toBeTruthy()
    expect(await db.manager.count()).toBe(0)
    await createManager(null, form({ ...newManager, password: "ж".repeat(36) }))
    expect(await db.manager.count()).toBe(1)
  })

  it.each([["manager"], [null]])("refuses create for %s", async (role) => {
    asRole(role)
    await expect(createManager(null, form(newManager))).rejects.toThrow(
      "Forbidden"
    )
    expect(await db.manager.count()).toBe(0)
  })

  it("reports invalid input instead of throwing", async () => {
    const r = await createManager(
      null,
      form({ ...newManager, password: "short" })
    )
    expect(r.error).toMatch(/Пароль/)
    expect(await db.manager.count()).toBe(0)
  })

  it("reports a taken login instead of throwing", async () => {
    expect(await createManager(null, form(newManager))).toEqual({})
    const r = await createManager(null, form({ ...newManager, name: "Другая" }))
    expect(r.error).toMatch(/занят/)
  })

  it("updates the name and, when given, the password", async () => {
    const m = await db.manager.create({
      data: {
        login: "b",
        name: "B",
        passwordHash: await bcrypt.hash("old-pass-1", 4),
      },
    })
    await updateManager(
      null,
      form({ id: String(m.id), name: "Боря", password: "" })
    )
    expect(await verifyCredentials("b", "old-pass-1")).not.toBeNull()
    await updateManager(
      null,
      form({ id: String(m.id), name: "Боря", password: "new-pass-12" })
    )
    expect(await verifyCredentials("b", "old-pass-1")).toBeNull()
    expect(await verifyCredentials("b", "new-pass-12")).not.toBeNull()
    expect(
      (await db.manager.findUniqueOrThrow({ where: { id: m.id } })).name
    ).toBe("Боря")
  })

  it("updateManager returns an error on invalid input instead of throwing", async () => {
    const m = await db.manager.create({
      data: { login: "v", name: "V", passwordHash: "x" },
    })
    for (const bad of [
      { id: String(m.id), name: " ", password: "" },
      { id: String(m.id), name: "V", password: "short" },
      { id: "abc", name: "V", password: "" },
    ])
      expect((await updateManager(null, form(bad))).error).toMatch(/Пароль/)
  })

  it("refuses update and disable for a manager", async () => {
    const m = await db.manager.create({
      data: { login: "c", name: "C", passwordHash: "x" },
    })
    asRole("manager")
    await expect(
      updateManager(null, form({ id: String(m.id), name: "Z", password: "" }))
    ).rejects.toThrow("Forbidden")
    await expect(
      setManagerActive(form({ id: String(m.id), active: "false" }))
    ).rejects.toThrow("Forbidden")
    expect(
      (await db.manager.findUniqueOrThrow({ where: { id: m.id } })).active
    ).toBe(true)
  })

  it("never touches a superadmin row", async () => {
    const s = await db.manager.create({
      data: { login: "root", name: "", passwordHash: "x", role: "superadmin" },
    })
    await setManagerActive(form({ id: String(s.id), active: "false" }))
    expect(
      (await db.manager.findUniqueOrThrow({ where: { id: s.id } })).active
    ).toBe(true)
  })
})

describe("disabled manager", () => {
  beforeEach(async () => {
    // authors are RESTRICT: clear their rows first
    await db.scheduleItem.deleteMany()
    await db.schedule.deleteMany()
    await db.template.deleteMany()
    await db.manager.deleteMany()
    asRole("superadmin")
  })

  it("cannot sign in, and an already issued session stops resolving", async () => {
    await createManager(null, form(newManager))
    const m = await db.manager.findUniqueOrThrow({ where: { login: "anna" } })
    expect(await activeSessionUser(m.id)).toMatchObject({ role: "manager" })

    await setManagerActive(form({ id: String(m.id), active: "false" }))

    expect(await verifyCredentials("anna", "longenough1")).toBeNull()
    expect(await activeSessionUser(m.id)).toBeNull()

    await setManagerActive(form({ id: String(m.id), active: "true" }))
    expect(await activeSessionUser(m.id)).not.toBeNull()
  })
})
