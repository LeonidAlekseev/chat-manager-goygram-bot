import { describe, expect, it } from "vitest"

import { decrypt, encrypt } from "@/lib/crypto"

import vector from "./crypto-vector.json"

// The same vector is checked by bot/tests/test_settings.py: panel and bot share the format.
describe("secret encryption", () => {
  it("decrypts the shared test vector", () => {
    expect(decrypt(vector.ciphertext, vector.secret)).toBe(vector.plaintext)
  })

  it("round-trips with a fresh IV every time", () => {
    const a = encrypt("hello", "k")
    expect(a).not.toBe(encrypt("hello", "k"))
    expect(decrypt(a, "k")).toBe("hello")
  })

  it("rejects a wrong key", () => {
    expect(() => decrypt(vector.ciphertext, "other")).toThrow()
  })

  it("rejects a truncated auth tag", () => {
    const raw = Buffer.from(encrypt("", "k"), "base64") // iv[12] | tag[16]
    const short = raw.subarray(0, 12 + 4).toString("base64")
    expect(() => decrypt(short, "k")).toThrow(/auth tag/)
  })
})
