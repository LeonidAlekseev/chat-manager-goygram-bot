import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AccountForm } from "@/app/(dashboard-layout)/settings/account-form"
import { describe, expect, it, vi } from "vitest"

import type { accountView } from "@/lib/settings"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock("@/app/(dashboard-layout)/settings/actions", () => ({
  loginStep: async () => null,
  logout: async () => {},
  restart: async () => {},
}))

const login = {
  pending: false,
  stuck: false,
  state: "qr",
  error: null,
  sent: null,
  resend: false,
  qr: "tg://login?token=AAAA",
}

describe("AccountForm QR login", () => {
  it("links the shown QR token to Telegram", () => {
    const html = renderToStaticMarkup(
      createElement(AccountForm, {
        view: { account: null, login } as Awaited<
          ReturnType<typeof accountView>
        >,
      })
    )
    expect(html).toContain('href="tg://login?token=AAAA"')
    expect(html).toContain("Открыть в Telegram")
  })
})
