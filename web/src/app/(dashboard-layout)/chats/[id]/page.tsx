import { notFound, redirect } from "next/navigation"
import {
  CalendarClock,
  ChevronRight,
  ExternalLink,
  Link2,
  Save,
  Users,
} from "lucide-react"

import type { Metadata } from "next"

import {
  canEdit,
  getViewer,
  isSuper,
  visibleChats,
  visibleSchedules,
  visibleTemplates,
} from "@/lib/access"
import { chatLink } from "@/lib/chat-link"
import { db } from "@/lib/db"
import { TIMEZONE } from "@/lib/timezone"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { ActionForm } from "@/components/action-form"
import { ChatAvatar } from "@/components/chat-avatar"
import { chip } from "@/components/chip"
import { Empty } from "@/components/empty"
import { ReadOnlyBadge } from "@/components/readonly-badge"
import { bindChat } from "../../schedules/actions"
import { toItemView } from "../../schedules/item-view"
import { ScheduleForm } from "../../schedules/schedule-form"
import { assignManagers } from "../actions"
import { DeleteChatForm } from "../delete-chat-form"
import { AbsentBadge, MentionHint, managerStatus } from "../member-status"

export const metadata: Metadata = { title: "Чат" }

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const v = await getViewer()
  if (!v) redirect("/login")
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) notFound()
  const chat = await db.chat.findFirst({
    where: { id, ...visibleChats(v) },
    include: {
      photo: { select: { uniqueId: true } },
      schedule: { include: { items: { orderBy: { time: "asc" } } } },
      // the superadmin sees every assigned manager's admin status (#99), a manager only their own
      managers: {
        where: isSuper(v) ? {} : { managerId: v.id },
        select: { managerId: true, memberStatus: true },
      },
    },
  })
  if (!chat || chat.deleting) notFound()
  const items = chat.schedule?.items.map(toItemView) ?? []
  const [schedules, templates, sharedWith, managers, me] = await Promise.all([
    db.schedule.findMany({
      where: visibleSchedules(v),
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.template.findMany({
      where: visibleTemplates(v),
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    chat.scheduleId
      ? db.chat.count({
          where: {
            scheduleId: chat.scheduleId,
            id: { not: chat.id },
            ...visibleChats(v),
          },
        })
      : 0,
    isSuper(v)
      ? db.manager.findMany({
          where: { role: "manager" },
          orderBy: [{ active: "desc" }, { login: "asc" }],
          select: {
            id: true,
            login: true,
            name: true,
            active: true,
            telegramUserId: true,
          },
        })
      : [],
    db.manager.findUnique({
      where: { id: v.id },
      select: { telegramUserId: true },
    }),
  ])
  const assigned = new Map(
    chat.managers.map((m) => [m.managerId, m.memberStatus])
  )
  const linked = !!me?.telegramUserId
  const myStatus = isSuper(v) ? null : (chat.managers[0]?.memberStatus ?? null)
  // a chat shared by two managers may follow the other one's schedule: show only that it exists
  const hidden =
    !!chat.scheduleId && !schedules.some((s) => s.id === chat.scheduleId)

  const link = chatLink(chat.username)

  return (
    <section className="grid gap-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ChatAvatar
              chat={{ id: chat.id, title: chat.title, photo: chat.photo }}
              className="size-10 rounded-xl text-base"
            />
            <CardTitle className="break-words">{chat.title}</CardTitle>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              className="whitespace-nowrap tabular-nums"
            >
              ID {chat.telegramId.toString()}
            </Badge>
            {linked && <AbsentBadge status={myStatus} />}
          </div>
          {(link || isSuper(v)) && (
            <div className="flex flex-wrap items-center gap-2">
              {link && (
                <Button asChild variant="outline">
                  <a href={link} target="_blank" rel="noopener noreferrer">
                    <ExternalLink />
                    Открыть в Telegram
                  </a>
                </Button>
              )}
              {isSuper(v) && <DeleteChatForm chat={chat} />}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!isSuper(v) && (!linked || myStatus === "absent") && (
            <MentionHint linked={linked} />
          )}
          <ActionForm action={bindChat} className="flex flex-wrap gap-2">
            <input type="hidden" name="chatId" value={chat.id} />
            <Select
              key={chat.scheduleId} // remount so a copy-on-write rebind shows up
              name="scheduleId"
              defaultValue={chat.scheduleId ?? ""}
              aria-label="Расписание чата"
            >
              <option value="">Без расписания</option>
              {hidden && (
                <option value={chat.scheduleId!}>
                  Расписание другого менеджера
                </option>
              )}
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="outline">
              <Link2 />
              Привязать
            </Button>
          </ActionForm>
        </CardContent>
      </Card>
      {chat.schedule && !hidden && (
        <Card>
          {/* collapsed by default, like the template cards */}
          <details id="schedule" className="group">
            <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="size-4 shrink-0 transition-transform group-open:rotate-90"
                aria-hidden
              />
              <CardTitle icon={CalendarClock}>Расписание чата</CardTitle>
              {!canEdit(v, chat.schedule) && <ReadOnlyBadge />}
            </summary>
            <CardContent>
              <ScheduleForm
                key={JSON.stringify(items)} // remount on saved changes, or the form resets to stale values
                schedule={{ ...chat.schedule, items }}
                timezone={TIMEZONE}
                templates={templates}
                chatId={chat.id}
                sharedWith={sharedWith}
                own={canEdit(v, chat.schedule)}
              />
            </CardContent>
          </details>
        </Card>
      )}
      {isSuper(v) && (
        <Card id="managers">
          <CardHeader>
            <CardTitle icon={Users}>Менеджеры чата</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={assignManagers} className="grid gap-2">
              <input type="hidden" name="id" value={chat.id} />
              {managers.length === 0 && <Empty>Менеджеров пока нет.</Empty>}
              {managers.map((m) => (
                <label key={m.id} className={chip}>
                  <input
                    type="checkbox"
                    name="managerId"
                    value={m.id}
                    defaultChecked={assigned.has(m.id)}
                  />
                  <span className="font-bold">{m.name || m.login}</span>
                  {!m.active && (
                    <span className="text-muted-foreground">(отключён)</span>
                  )}
                  {assigned.has(m.id) && (
                    <span className="text-muted-foreground">
                      — {managerStatus(assigned.get(m.id)!, !!m.telegramUserId)}
                    </span>
                  )}
                </label>
              ))}
              <Button type="submit" variant="outline" className="w-fit">
                <Save />
                Сохранить менеджеров
              </Button>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </section>
  )
}
