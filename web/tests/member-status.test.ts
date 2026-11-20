import { renderToStaticMarkup } from "react-dom/server"
import ChatPage from "@/app/(dashboard-layout)/chats/[id]/page"
import { assignManagers } from "@/app/(dashboard-layout)/chats/actions"
import ChatsPage from "@/app/(dashboard-layout)/chats/page"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/lib/db"

const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("@/auth", () => ({ auth: async () => session.current }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`)
  },
  notFound: () => {
    throw new Error("not found")
  },
  useRouter: () => ({ refresh: () => {} }),
}))

const as = (login: string) => (session.current = { user: { name: login } })
const list = async () => renderToStaticMarkup(await ChatsPage())
const page = async (id: number) =>
  renderToStaticMarkup(
    await ChatPage({ params: Promise.resolve({ id: `${id}` }) })
  )
const count = (html: string, s: string) => html.split(s).length - 1

const ids: Record<string, number> = {}

// #99: the bot writes chat_managers.member_status; the panel shows the manager where they are not an admin
describe("admin status badges", () => {
  beforeEach(async () => {
    await db.chat.deleteMany()
    await db.manager.deleteMany({ where: { login: { startsWith: "ms-" } } })
    const mk = (login: string, role: "superadmin" | "manager", tg?: number) =>
      db.manager.create({
        data: {
          login,
          role,
          passwordHash: "x",
          telegramUserId: tg ? BigInt(tg) : null,
        },
      })
    await mk("ms-root", "superadmin")
    ids.linked = (await mk("ms-linked", "manager", 5001)).id
    ids.unlinked = (await mk("ms-unlinked", "manager")).id
    for (const [title, status] of [
      ["Участник", "member"],
      ["Админ", "admin"],
      ["Без меня", "absent"],
      ["Ошибка", "unknown"],
    ])
      ids[title] = (
        await db.chat.create({
          data: {
            telegramId: -Math.floor(Math.random() * 1e12),
            title,
            managers: {
              create: [
                { managerId: ids.linked, memberStatus: status },
                { managerId: ids.unlinked, memberStatus: "member" },
              ],
            },
          },
        })
      ).id
  })

  it("a linked manager sees a badge only where they are absent from the chat", async () => {
    as("ms-linked")
    const html = await list()
    expect(count(html, "Вы не администратор")).toBe(0)
    expect(count(html, "Вас нет в чате")).toBe(1)
    expect(html).toContain("/all работает для администраторов")
    expect(await page(ids["Участник"])).not.toContain("Вы не администратор")
    for (const t of ["Админ", "Ошибка", "Участник"]) {
      const chat = await page(ids[t])
      expect(chat).not.toContain("Вы не администратор")
      expect(chat).not.toContain("Вас нет в чате")
    }
  })

  it("an unlinked manager sees no badge, only the hint to link Telegram", async () => {
    as("ms-unlinked")
    const html = await list()
    expect(html).not.toContain("Вы не администратор")
    expect(html).toContain("пользоваться /all")
    expect(await page(ids["Участник"])).not.toContain("Вы не администратор")
  })

  it("no hint for a manager who is in every chat", async () => {
    await db.chatManager.updateMany({
      where: { managerId: ids.linked },
      data: { memberStatus: "member" },
    })
    as("ms-linked")
    expect(await list()).not.toContain("/all работает")
  })

  it("the superadmin sees every assigned manager's status, no badge of their own", async () => {
    as("ms-root")
    expect(await list()).not.toContain("Вас нет в чате")
    const html = await page(ids["Участник"])
    expect(html).toContain("Не администратор")
    expect(html).toContain("Telegram не привязан")
    expect(await page(ids["Админ"])).toContain("Администратор")
  })

  it("reassigning keeps the kept managers' statuses; a new one is checked", async () => {
    as("ms-root")
    const other = await db.manager.create({
      data: {
        login: "ms-other",
        passwordHash: "x",
        telegramUserId: BigInt(5002),
      },
    })
    const f = new FormData()
    f.set("id", String(ids["Участник"]))
    for (const m of [ids.linked, other.id]) f.append("managerId", String(m))
    expect((await assignManagers(f)).error).toBeUndefined()
    const rows = await db.chatManager.findMany({
      where: { chatId: ids["Участник"] },
      orderBy: { managerId: "asc" },
      select: { managerId: true, memberStatus: true },
    })
    expect(rows).toEqual([
      { managerId: ids.linked, memberStatus: "member" },
      { managerId: other.id, memberStatus: null },
    ])
    expect(await page(ids["Участник"])).toContain("Проверяется")
  })
})
