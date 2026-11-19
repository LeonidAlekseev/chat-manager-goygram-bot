import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Voter } from "@/app/(dashboard-layout)/logs/[id]/voter"
import { describe, expect, it } from "vitest"

const html = (v: Parameters<typeof Voter>[0]["v"]) =>
  renderToStaticMarkup(createElement(Voter, { v }))

describe("Voter", () => {
  it("shows the full name, the id and the username linked to t.me", () => {
    const out = html({
      userId: BigInt(123456789),
      name: "Анна К",
      firstName: "Анна",
      lastName: "Кузнецова",
      username: "anna_k",
    })
    expect(out).toContain("Анна Кузнецова")
    expect(out).toContain("ID 123456789")
    expect(out).toContain(
      '<a href="https://t.me/anna_k" target="_blank" rel="noopener noreferrer"'
    )
    expect(out).toContain("@anna_k</a>")
  })

  it("has no link without a username", () => {
    const out = html({
      userId: BigInt(5),
      firstName: "Борис",
      lastName: null,
      username: null,
    })
    expect(out).toContain("Борис")
    expect(out).toContain("ID 5")
    expect(out).not.toContain("<a")
  })

  it("shows the old joined name and the id for rows without split names", () => {
    const out = html({
      userId: BigInt(7),
      name: "Старое Имя",
      firstName: null,
      lastName: null,
      username: null,
    })
    expect(out).toContain("Старое Имя")
    expect(out).toContain("ID 7")
  })

  it("shows the id alone for a member with no name known", () => {
    expect(html({ userId: BigInt(8) })).toContain("ID 8")
  })
})
