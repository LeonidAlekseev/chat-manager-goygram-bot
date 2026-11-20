import { expect, test } from "vitest"

import { chatLink } from "@/lib/chat-link"

test("supergroup gets a t.me/c link, a plain group none", () => {
  expect(chatLink(BigInt("-1004347671502"))).toBe("https://t.me/c/4347671502")
  expect(chatLink(BigInt("-4347671502"))).toBeNull()
})
