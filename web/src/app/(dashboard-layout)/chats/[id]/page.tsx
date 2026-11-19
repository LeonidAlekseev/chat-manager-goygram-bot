import { notFound, redirect } from "next/navigation"

import type { Metadata } from "next"

import {
  canEdit,
  getViewer,
  isSuper,
  visibleChats,
  visibleSchedules,
  visibleTemplates,
} from "@/lib/access"
import { db } from "@/lib/db"
import { TIMEZONE } from "@/lib/timezone"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { ActionForm } from "@/components/action-form"
import { bindChat } from "../../schedules/actions"
import { toItemView } from "../../schedules/item-view"
import { ScheduleForm } from "../../schedules/schedule-form"
import { assignManagers } from "../actions"
import { DeleteChatForm } from "../delete-chat-form"

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
      schedule: { include: { items: { orderBy: { time: "asc" } } } },
      managers: { select: { managerId: true } },
    },
  })
  if (!chat || chat.deleting) notFound()
  const items = chat.schedule?.items.map(toItemView) ?? []
  const [schedules, templates, sharedWith, managers] = await Promise.all([
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
          where: { scheduleId: chat.scheduleId, id: { not: chat.id } },
        })
      : 0,
    isSuper(v)
      ? db.manager.findMany({
          where: { role: "manager" },
          orderBy: [{ active: "desc" }, { login: "asc" }],
          select: { id: true, login: true, name: true, active: true },
        })
      : [],
  ])
  const assigned = new Set(chat.managers.map((m) => m.managerId))
  // a chat shared by two managers may follow the other one's schedule: show only that it exists
  const hidden =
    !!chat.scheduleId && !schedules.some((s) => s.id === chat.scheduleId)

  return (
    <section className="container grid gap-4 p-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>{chat.title}</CardTitle>
          {isSuper(v) && <DeleteChatForm chat={chat} />}
        </CardHeader>
        <CardContent>
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
              Привязать
            </Button>
          </ActionForm>
        </CardContent>
      </Card>
      {chat.schedule && !hidden && (
        <Card>
          <CardHeader>
            <CardTitle>Расписание чата</CardTitle>
          </CardHeader>
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
        </Card>
      )}
      {isSuper(v) && (
        <Card>
          <CardHeader>
            <CardTitle>Менеджеры чата</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={assignManagers} className="grid gap-2">
              <input type="hidden" name="id" value={chat.id} />
              {managers.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Менеджеров пока нет.
                </p>
              )}
              {managers.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="managerId"
                    value={m.id}
                    defaultChecked={assigned.has(m.id)}
                  />
                  {m.name || m.login}
                  {!m.active && (
                    <span className="text-muted-foreground">(отключён)</span>
                  )}
                </label>
              ))}
              <Button type="submit" variant="outline" className="w-fit">
                Сохранить менеджеров
              </Button>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </section>
  )
}
