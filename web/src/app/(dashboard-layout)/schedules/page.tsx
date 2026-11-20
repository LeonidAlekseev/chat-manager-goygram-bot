import { redirect } from "next/navigation"
import {
  CalendarClock,
  ChevronRight,
  Clock,
  Lock,
  Plus,
  Repeat,
  Save,
} from "lucide-react"

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

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ActionForm } from "@/components/action-form"
import { chip } from "@/components/chip"
import { Empty } from "@/components/empty"
import { bindChats } from "./actions"
import { DeleteScheduleForm } from "./delete-schedule-form"
import { PERIODS, byTime, toItemView } from "./item-view"
import { ScheduleForm } from "./schedule-form"

export const metadata: Metadata = { title: "Расписания" }

const day = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC", // startDate is a calendar date stored at UTC midnight
})

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
    <section className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle icon={Plus}>Новое расписание</CardTitle>
        </CardHeader>
        <CardContent>
          <ScheduleForm templates={templates} timezone={TIMEZONE} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle icon={CalendarClock}>
            Расписания · {schedules.length}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {schedules.length === 0 && <Empty>Расписаний пока нет.</Empty>}
          {schedules.map((s) => {
            const items = s.items.map(toItemView)
            return (
              // the delete form sits over the card, not in <summary>: iOS Safari may toggle instead of submit
              <div key={s.id} className="relative">
                <details className="group w-full min-w-0 rounded-xl border bg-card p-4 open:border-primary">
                  <summary className="flex cursor-pointer list-none items-start gap-2 pr-12 [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      className="mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-90"
                      aria-hidden
                    />
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-bold break-words">{s.name}</span>
                        {!canEdit(v, s) && (
                          <Badge
                            variant="secondary"
                            title="Только суперадмин меняет"
                          >
                            <Lock aria-hidden />
                            Неизменяемый
                          </Badge>
                        )}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {s.items.length
                          ? `шаблонов: ${s.items.length}`
                          : "нет шаблонов"}{" "}
                        · чатов:{" "}
                        {chats.filter((c) => c.scheduleId === s.id).length}
                      </span>
                      {s.items.length > 0 && (
                        // a timeline: time on the left, what and how often on the right (spans: <summary> holds phrasing content)
                        <span
                          role="list"
                          className="mt-1 grid border-l-2 border-primary-soft pl-4 group-open:hidden"
                        >
                          {[...items].sort(byTime).map((i) => (
                            <span
                              role="listitem"
                              key={i.id}
                              className="relative py-1"
                            >
                              <span
                                aria-hidden
                                className="absolute top-2.5 -left-[23px] size-3 rounded-full border-2 border-card bg-primary"
                              />
                              <span className="flex flex-wrap items-baseline gap-x-2">
                                <span className="inline-flex items-center gap-1 font-mono text-sm font-bold tabular-nums">
                                  <Clock
                                    className="size-3.5 text-muted-foreground"
                                    aria-hidden
                                  />
                                  {i.time}
                                </span>
                                <span className="min-w-0 text-sm break-words">
                                  {/* only visible templates: a superadmin's schedule may hold another manager's */}
                                  {templates.find((t) => t.id === i.templateId)
                                    ?.name ?? "Шаблон другого менеджера"}
                                </span>
                              </span>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Repeat className="size-3" aria-hidden />
                                {PERIODS.find(([p]) => p === i.period)?.[1] ??
                                  i.period}{" "}
                                · с {day.format(new Date(i.startDate))}
                              </span>
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </summary>
                  <div className="mt-4 grid gap-4">
                    <ScheduleForm
                      key={JSON.stringify(items)} // remount on saved changes, or the form resets to stale values
                      schedule={{ ...s, items }}
                      templates={templates}
                      timezone={TIMEZONE}
                      own={canEdit(v, s)}
                    />
                    <ActionForm action={bindChats} className="grid gap-2">
                      <input type="hidden" name="id" value={s.id} />
                      <p className="text-sm font-bold text-muted-foreground">
                        Чаты
                      </p>
                      {chats.length === 0 && <Empty>Чатов пока нет.</Empty>}
                      {chats.map((c) => (
                        <label key={c.id} className={chip}>
                          <input
                            type="checkbox"
                            name="chatId"
                            value={c.id}
                            defaultChecked={c.scheduleId === s.id}
                          />
                          <span className="font-bold">{c.title}</span>
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
                        <Save />
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
