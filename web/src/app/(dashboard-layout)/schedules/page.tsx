import { redirect } from "next/navigation"
import { ChevronRight } from "lucide-react"

import type { Metadata } from "next"

import {
  canEdit,
  getViewer,
  visibleChats,
  visibleSchedules,
  visibleTemplates,
} from "@/lib/access"
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
  const v = await getViewer()
  if (!v) redirect("/login")
  const [schedules, templates, chats] = await Promise.all([
    db.schedule.findMany({
      where: visibleSchedules(v),
      orderBy: { name: "asc" },
      include: { items: { orderBy: { time: "asc" } } },
    }),
    db.template.findMany({
      where: visibleTemplates(v),
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.chat.findMany({
      where: { deleting: false, ...visibleChats(v) },
      orderBy: [{ active: "desc" }, { title: "asc" }],
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
              // the delete form sits over the card, not in <summary>: iOS Safari may toggle instead of submit
              <div key={s.id} className="relative">
                <details className="group w-full min-w-0 rounded-md border p-3">
                  <summary className="flex cursor-pointer list-none items-start gap-2 pr-10 [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      className="mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-90"
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="break-words">{s.name}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {s.items.length
                          ? `шаблонов: ${s.items.length}`
                          : "нет шаблонов"}{" "}
                        · чатов:{" "}
                        {chats.filter((c) => c.scheduleId === s.id).length}
                      </span>
                    </span>
                  </summary>
                  <div className="mt-3 grid gap-4">
                    <ScheduleForm
                      key={JSON.stringify(items)} // remount on saved changes, or the form resets to stale values
                      schedule={{ ...s, items }}
                      templates={templates}
                      timezone={TIMEZONE}
                      own={canEdit(v, s)}
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
                          {c.scheduleId && c.scheduleId !== s.id && (
                            <span className="text-muted-foreground">
                              (сейчас:{" "}
                              {schedules.find((x) => x.id === c.scheduleId)
                                ?.name ?? "расписание другого менеджера"}
                              )
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
                  </div>
                </details>
                {canEdit(v, s) && (
                  <DeleteScheduleForm
                    id={s.id}
                    name={s.name}
                    chats={chats.filter((c) => c.scheduleId === s.id).length}
                  />
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </section>
  )
}
