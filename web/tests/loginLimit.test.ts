import { describe, expect, it } from "vitest"

import {
  isLoginBlocked,
  loginKey,
  recordLoginFailure,
  resetLoginFailures,
} from "@/lib/loginLimit"

describe("login rate limit", () => {
  it("blocks after 5 failures and unblocks after 15 minutes", () => {
    const k = "a|1.1.1.1"
    for (let i = 0; i < 4; i++) recordLoginFailure(k, 0)
    expect(isLoginBlocked(k, 1)).toBe(false)
    recordLoginFailure(k, 0)
    expect(isLoginBlocked(k, 1)).toBe(true)
    expect(isLoginBlocked(k, 15 * 60_000 + 1)).toBe(false)
  })

  it("counts per login+IP and resets on success", () => {
    for (let i = 0; i < 5; i++) recordLoginFailure("b|1.1.1.1", 0)
    expect(isLoginBlocked("b|2.2.2.2", 1)).toBe(false)
    resetLoginFailures("b|1.1.1.1")
    expect(isLoginBlocked("b|1.1.1.1", 1)).toBe(false)
  })

  it("takes the IP from the last x-forwarded-for entry (set by our proxy)", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" })
    expect(loginKey("a", h)).toBe("a|1.2.3.4")
    expect(loginKey("a", new Headers())).toBe("a|unknown")
  })

  it("caps the login length in the key", () => {
    expect(loginKey("x".repeat(500), new Headers()).length).toBeLessThan(80)
  })

  it("evicts the oldest keys at the cap instead of growing", () => {
    for (let i = 0; i < 10_050; i++) recordLoginFailure(`junk${i}|ip`, 0)
    for (let i = 0; i < 5; i++) recordLoginFailure("late|ip", 0)
    expect(isLoginBlocked("late|ip", 1)).toBe(true)
    expect(isLoginBlocked("junk0|ip", 1)).toBe(false)
  })
})
