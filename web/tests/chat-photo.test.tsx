import { renderToStaticMarkup } from "react-dom/server"
import { GET } from "@/app/api/chats/[id]/photo/route"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/lib/db"

import { ChatAvatar } from "@/components/chat-avatar"

const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("@/auth", () => ({ auth: async () => session.current }))

const as = (login: string | null) =>
  (session.current = login ? { user: { name: login } } : null)
const get = (id: number | string, headers: Record<string, string> = {}) =>
  GET(new Request(`http://x/api/chats/${id}/photo`, { headers }), {
    params: Promise.resolve({ id: `${id}` }),
  })

const ids: Record<string, number> = {}
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

// #113: the bot stores chat photos, the panel serves them only to who may see the chat (#92)
describe("chat photo route", () => {
  beforeEach(async () => {
    await db.chat.deleteMany()
    await db.manager.deleteMany({ where: { login: { startsWith: "cp-" } } })
    await db.manager.create({
      data: { login: "cp-root", role: "superadmin", passwordHash: "x" },
    })
    const mgr = await db.manager.create({
      data: { login: "cp-mgr", role: "manager", passwordHash: "x" },
    })
    const mk = (title: string, assigned: boolean) =>
      db.chat.create({
        data: {
          telegramId: -Math.floor(Math.random() * 1e12),
          title,
          photo: {
            create: { uniqueId: `u-${title}`, mime: "image/jpeg", data: JPEG },
          },
          managers: assigned ? { create: { managerId: mgr.id } } : undefined,
        },
      })
    ids.mine = (await mk("mine", true)).id
    ids.other = (await mk("other", false)).id
    ids.bare = (
      await db.chat.create({ data: { telegramId: -1, title: "bare" } })
    ).id
  })

  it("serves the photo with a private cache and an ETag", async () => {
    as("cp-mgr")
    const res = await get(ids.mine)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/jpeg")
    expect(res.headers.get("cache-control")).toMatch(/^private, max-age=\d+/)
    expect(res.headers.get("etag")).toBe('"u-mine"')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG)
  })

  it("answers 304 to a matching If-None-Match", async () => {
    as("cp-mgr")
    const res = await get(ids.mine, { "if-none-match": '"u-mine"' })
    expect(res.status).toBe(304)
    expect(await res.text()).toBe("")
    expect((await get(ids.mine, { "if-none-match": '"old"' })).status).toBe(200)
  })

  it("is 404 for another manager's chat, no photo, no session, a bad id", async () => {
    as("cp-mgr")
    expect((await get(ids.other)).status).toBe(404)
    expect((await get(ids.bare)).status).toBe(404)
    expect((await get("abc")).status).toBe(404)
    expect((await get("99999999999")).status).toBe(404)
    as("cp-root")
    expect((await get(ids.other)).status).toBe(200)
    as(null)
    expect((await get(ids.mine)).status).toBe(404)
  })
})

describe("ChatAvatar", () => {
  it("shows the photo, versioned by its unique id", () => {
    const html = renderToStaticMarkup(
      <ChatAvatar chat={{ id: 7, title: "Чат", photo: { uniqueId: "abc" } }} />
    )
    expect(html).toContain('src="/api/chats/7/photo?v=abc"')
    expect(html).toContain('width="32"')
  })

  it("falls back to the title's first letter", () => {
    const html = renderToStaticMarkup(
      <ChatAvatar chat={{ id: 7, title: "чат", photo: null }} />
    )
    expect(html).not.toContain("<img")
    expect(html).toContain(">ч</span>")
  })
})
