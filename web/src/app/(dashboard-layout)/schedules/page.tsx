import { redirect } from "next/navigation"
import { auth } from "@/auth"

import type { Metadata } from "next"

import { db } from "@/lib/db"
import { TIMEZONE } from "@/lib/timezone"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ActionForm } from "@/components/action-form"
import { bindChats } from "./actions"
import { DeleteScheduleForm } from "./delete-schedule-form"
import { toItemView } from "./item-view"
import { ScheduleForm } from "./schedule-form"

export const metadata: Metadata = { title: "Расписания" }

export default async function SchedulesPage() {
  if (!(await auth())) redirect("/login")
  const [schedules, templates, chats] = await Promise.all([
    db.schedule.findMany({
      orderBy: { name: "asc" },
      include: { items: { orderBy: { time: "asc" } } },
    }),
    db.template.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.chat.findMany({
      orderBy: [{ active: "desc" }, { title: "asc" }],
      include: { schedule: { select: { name: true } } },
    }),
  ])

  return (
    <section className="container grid gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Новое расписание</CardTitle>
        </CardHeader>
        <CardContent>
          <ScheduleForm templates={templates} timezone={TIMEZONE} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Расписания</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {schedules.length === 0 && (
            <p className="text-muted-foreground">Расписаний пока нет.</p>
          )}
          {schedules.map((s) => {
            const items = s.items.map(toItemView)
            return (
              <details key={s.id} className="rounded-md border p-3">
                <summary className="cursor-pointer">
                  {s.name}{" "}
                  <span className="text-sm text-muted-foreground">
                    ·{" "}
                    {s.items.length
                      ? `пунктов: ${s.items.length}`
                      : "нет пунктов"}{" "}
                    · чатов: {chats.filter((c) => c.scheduleId === s.id).length}
                  </span>
                </summary>
                <div className="mt-3 grid gap-4">
                  <ScheduleForm
                    key={JSON.stringify(items)} // remount on saved changes, or the form resets to stale values
                    schedule={{ ...s, items }}
                    templates={templates}
                    timezone={TIMEZONE}
                  />
                  <ActionForm action={bindChats} className="grid gap-2">
                    <input type="hidden" name="id" value={s.id} />
                    <p className="text-sm font-medium">Чаты</p>
                    {chats.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        Чатов пока нет.
                      </p>
                    )}
                    {chats.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          name="chatId"
                          value={c.id}
                          defaultChecked={c.scheduleId === s.id}
                        />
                        {c.title}
                        {c.schedule && c.scheduleId !== s.id && (
                          <span className="text-muted-foreground">
                            (сейчас: {c.schedule.name})
                          </span>
                        )}
                        {!c.active && (
                          <span className="text-muted-foreground">
                            (бот удалён)
                          </span>
                        )}
                      </label>
                    ))}
                    <Button type="submit" variant="outline" className="w-fit">
                      Сохранить привязку
                    </Button>
                  </ActionForm>
                  <DeleteScheduleForm
                    id={s.id}
                    chats={chats.filter((c) => c.scheduleId === s.id).length}
                  />
                </div>
              </details>
            )
          })}
        </CardContent>
      </Card>
    </section>
  )
}
