import { CalendarClock, Clock, Lock, Plus, Repeat, Trash2 } from "lucide-react"

import type { Viewer } from "@/lib/access"

import {
  canEdit,
  visibleChats,
  visibleSchedules,
  visibleTemplates,
} from "@/lib/access"
import { db } from "@/lib/db"
import { TIMEZONE } from "@/lib/timezone"

import { Empty, Field, MOCK, Panel, Pill, control } from "@/components/v2/ui"

const PERIODS: Record<string, string> = {
  none: "Один раз",
  day: "Каждый день",
  week: "Каждую неделю",
  twoweek: "Раз в две недели",
  month: "Каждый месяц",
  custom: "Своя (cron)",
}

const day = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC", // startDate is a calendar date stored at UTC midnight
})

export async function SchedulesTab({ v }: { v: Viewer }) {
  const [schedules, templates, chats] = await Promise.all([
    db.schedule.findMany({
      where: visibleSchedules(v),
      orderBy: { name: "asc" },
      include: {
        items: {
          orderBy: { time: "asc" },
        },
      },
    }),
    db.template.findMany({
      where: visibleTemplates(v),
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.chat.findMany({
      where: { deleting: false, ...visibleChats(v) },
      orderBy: { title: "asc" },
      select: { id: true, title: true, scheduleId: true },
    }),
  ])
  // the form shows the first schedule's points, or one blank point
  const sample = schedules.find((s) => s.items.length)?.items.slice(0, 3) ?? []
  const rows = sample.length
    ? sample.map((i) => ({
        key: i.id,
        templateId: i.templateId,
        time: i.time,
        startDate: i.startDate.toISOString().slice(0, 10),
        period: i.period,
      }))
    : [
        {
          key: 0,
          templateId: templates[0]?.id ?? 0,
          time: "08:00",
          startDate: new Date().toISOString().slice(0, 10),
          period: "day",
        },
      ]

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel title="Новое расписание" icon={Plus}>
        <fieldset disabled className="grid gap-4">
          <Field label="Название">
            <input className={control} placeholder="Будни, утро" />
          </Field>
          <div className="grid gap-2">
            <p className="text-sm font-bold text-(--v2-muted)">
              Пункты · время по {TIMEZONE}
            </p>
            <ol className="grid gap-2">
              {rows.map((r, n) => (
                <li
                  key={r.key}
                  className="grid gap-3 rounded-xl border border-(--v2-line) bg-(--v2-bg) p-3 sm:grid-cols-2"
                >
                  <div className="flex items-center justify-between sm:col-span-2">
                    <span className="text-xs font-black text-(--v2-primary)">
                      Пункт {n + 1}
                    </span>
                    <button
                      type="button"
                      title={MOCK}
                      aria-label={`Удалить пункт ${n + 1}`}
                      className="grid size-11 cursor-not-allowed place-items-center rounded-lg text-(--v2-muted)"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                  <Field label="Шаблон" className="sm:col-span-2">
                    <select className={control} defaultValue={r.templateId}>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Время">
                    <input
                      className={control}
                      type={r.period === "custom" ? "text" : "time"}
                      defaultValue={r.time}
                    />
                  </Field>
                  <Field label="Начиная с">
                    <input
                      className={control}
                      type="date"
                      defaultValue={r.startDate}
                    />
                  </Field>
                  <Field label="Повтор" className="sm:col-span-2">
                    <select className={control} defaultValue={r.period}>
                      {Object.entries(PERIODS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </li>
              ))}
            </ol>
            <button
              type="button"
              title={MOCK}
              className="inline-flex h-11 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-dashed border-(--v2-primary) font-bold text-(--v2-primary)"
            >
              <Plus className="size-4" aria-hidden />
              Добавить пункт
            </button>
          </div>
          <button
            type="button"
            title={MOCK}
            className="h-11 cursor-not-allowed rounded-xl bg-(--v2-primary) px-4 font-bold text-white"
          >
            Сохранить расписание
          </button>
        </fieldset>
      </Panel>

      <Panel title={`Расписания · ${schedules.length}`} icon={CalendarClock}>
        {schedules.length === 0 ? (
          <Empty>Расписаний пока нет.</Empty>
        ) : (
          <ul className="grid gap-3">
            {schedules.map((s) => {
              const bound = chats.filter((c) => c.scheduleId === s.id)
              return (
                <li
                  key={s.id}
                  className="grid min-w-0 gap-3 rounded-xl border border-(--v2-line) p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 flex-1 font-bold break-words">
                      {s.name}
                    </h3>
                    {!canEdit(v, s) && (
                      <Pill icon={Lock} title="Только суперадмин меняет">
                        Суперадмина
                      </Pill>
                    )}
                  </div>
                  {s.items.length === 0 ? (
                    <p className="text-sm text-(--v2-muted)">Нет пунктов</p>
                  ) : (
                    // a timeline: time on the left, what and how often on the right
                    <ol className="grid gap-0 border-l-2 border-(--v2-primary-soft) pl-4">
                      {s.items.map((i) => (
                        <li key={i.id} className="relative py-1.5">
                          <span
                            aria-hidden
                            className="absolute top-3 -left-[23px] size-3 rounded-full border-2 border-(--v2-surface) bg-(--v2-primary)"
                          />
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="inline-flex items-center gap-1 font-mono text-sm font-bold tabular-nums">
                              <Clock
                                className="size-3.5 text-(--v2-muted)"
                                aria-hidden
                              />
                              {i.time}
                            </span>
                            <span className="min-w-0 text-sm break-words">
                              {/* only visible templates: a superadmin's schedule may hold another manager's */}
                              {templates.find((t) => t.id === i.templateId)
                                ?.name ?? "Шаблон другого менеджера"}
                            </span>
                          </div>
                          <p className="flex items-center gap-1 text-xs text-(--v2-muted)">
                            <Repeat className="size-3" aria-hidden />
                            {PERIODS[i.period] ?? i.period} · с{" "}
                            {day.format(i.startDate)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {bound.length === 0 ? (
                      <span className="text-xs text-(--v2-muted)">
                        Не привязано к чатам
                      </span>
                    ) : (
                      bound.map((c) => (
                        <Pill key={c.id} tone="primary">
                          {c.title}
                        </Pill>
                      ))
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}
