import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"

import type { Metadata } from "next"

import { db } from "@/lib/db"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  if (!Number.isInteger(id)) notFound()
  const chat = await db.chat.findUnique({
    where: { id },
    include: {
      schedule: { include: { items: { orderBy: { time: "asc" } } } },
    },
  })
  if (!chat) notFound()
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
          <form action={bindChat} className="flex flex-wrap gap-2">
            <input type="hidden" name="chatId" value={chat.id} />
            <select
              key={chat.scheduleId} // remount so a copy-on-write rebind shows up
              name="scheduleId"
              defaultValue={chat.scheduleId ?? ""}
              aria-label="Расписание чата"
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Без расписания</option>
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline">
              Привязать
            </Button>
          </form>
        </CardContent>
      </Card>
      {chat.schedule && (
        <Card>
          <CardHeader>
            <CardTitle>Расписание чата</CardTitle>
          </CardHeader>
          <CardContent>
            <ScheduleForm
              key={chat.schedule.items.map((i) => i.id).join()}
              schedule={{
                ...chat.schedule,
                items: chat.schedule.items.map(toItemView),
              }}
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
