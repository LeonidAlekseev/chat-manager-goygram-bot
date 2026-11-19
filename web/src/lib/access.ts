import { auth } from "@/auth"

import type { Prisma, Role } from "@prisma/client"

import { db } from "@/lib/db"

// Who may see and change what (#92). Every page and action filters through these, the UI only mirrors them.
export type Viewer = { id: number; role: Role }

// The session carries the login only; the role is re-read so a demotion applies at once.
export async function getViewer(): Promise<Viewer | null> {
  const login = (await auth())?.user?.name
  if (!login) return null
  return db.manager.findFirst({
    where: { login, active: true },
    select: { id: true, role: true },
  })
}

export const isSuper = (v: Viewer) => v.role === "superadmin"

// Templates and schedules: the superadmin's (no author, or a superadmin author) plus the manager's own.
function authored(v: Viewer) {
  return isSuper(v)
    ? {}
    : {
        OR: [
          { authorId: null },
          { authorId: v.id },
          { author: { role: "superadmin" as const } },
        ],
      }
}
export const visibleTemplates = (v: Viewer): Prisma.TemplateWhereInput =>
  authored(v)
export const visibleSchedules = (v: Viewer): Prisma.ScheduleWhereInput =>
  authored(v)

// A manager works only with the chats the superadmin assigned to them.
export const visibleChats = (v: Viewer): Prisma.ChatWhereInput =>
  isSuper(v) ? {} : { managers: { some: { managerId: v.id } } }

// Journal and outbox rows of visible chats; a send of another manager's template stays hidden.
export const visibleSends = (
  v: Viewer
): Prisma.SendLogWhereInput & Prisma.OutboxWhereInput =>
  isSuper(v)
    ? {}
    : {
        chat: visibleChats(v),
        OR: [{ templateId: null }, { template: visibleTemplates(v) }],
      }

// may the viewer edit a row they can see
export const canEdit = (v: Viewer, row: { authorId: number | null }) =>
  isSuper(v) || row.authorId === v.id

export const NOT_FOUND = "Не найдено — обновите страницу"

// `row` comes from a visible* query: missing = not found, visible but not own = the superadmin's.
export function editError(
  v: Viewer,
  row: { authorId: number | null } | null,
  what: "шаблон" | "расписание"
): string | null {
  if (!row) return NOT_FOUND
  if (canEdit(v, row)) return null
  return `Это ${what} суперадмина — изменить нельзя`
}
