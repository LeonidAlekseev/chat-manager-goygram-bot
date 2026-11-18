import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"

import type { Metadata } from "next"

import { db } from "@/lib/db"
import { TIMEZONE } from "@/lib/timezone"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { ActionForm } from "@/components/action-form"
import { bindChat } from "../../schedules/actions"
import { toItemView } from "../../schedules/item-view"
import { ScheduleForm } from "../../schedules/schedule-form"

export const metadata: Metadata = { title: "Чат" }

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await auth())) redirect("/login")
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) notFound()
  const chat = await db.chat.findUnique({
    where: { id },
    include: {
      schedule: { include: { items: { orderBy: { time: "asc" } } } },
    },
  })
  if (!chat) notFound()
  const items = chat.schedule?.items.map(toItemView) ?? []
  const [schedules, templates, sharedWith] = await Promise.all([
    db.schedule.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.template.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    chat.scheduleId
      ? db.chat.count({
          where: { scheduleId: chat.scheduleId, id: { not: chat.id } },
        })
      : 0,
  ])

  return (
    <section className="container grid gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{chat.title}</CardTitle>
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
      {chat.schedule && (
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
            />
          </CardContent>
        </Card>
      )}
    </section>
  )
}
