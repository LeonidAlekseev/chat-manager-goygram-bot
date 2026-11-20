import { expect, test } from "vitest"

import { chatLink } from "@/lib/chat-link"

test("a public group links to t.me/<username>, a private one has no link", () => {
  expect(chatLink("goy_chat")).toBe("https://t.me/goy_chat")
  expect(chatLink(null)).toBeNull()
})
