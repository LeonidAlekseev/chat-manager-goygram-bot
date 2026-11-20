import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { DiscoverChats } from "@/app/(dashboard-layout)/chats/discover-chats"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock("@/app/(dashboard-layout)/chats/actions", () => ({
  discoverChats: async () => ({}),
}))

const render = (scan: Parameters<typeof DiscoverChats>[0]["scan"]) =>
  renderToStaticMarkup(createElement(DiscoverChats, { scan }))

describe("DiscoverChats", () => {
  it("offers the scan and says which groups it can find", () => {
    const html = render(null)
    expect(html).toContain("Найти группы бота")
    expect(html).toContain("и бот, и подключённый")
  })

  it("shows a running scan and the result of a finished one", () => {
    expect(
      render({ state: "running", found: null, added: null, error: null })
    ).toContain("Ищем группы…")
    const done = render({ state: "done", found: 5, added: 2, error: null })
    expect(done).toContain("Найдено 5, добавлено 2")
    expect(
      render({ state: "done", found: 1, added: 1, error: "Telegram ограничил" })
    ).toContain("Telegram ограничил")
  })
})
