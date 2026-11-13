import { describe, expect, it } from "vitest"

import {
  isLoginBlocked,
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
})
