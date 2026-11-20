"use client"

import { useState } from "react"

import { describeCron, nextRuns, parseCron } from "@/lib/cron"
import { nowInZone } from "@/lib/timezone"

import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"

const PRESETS = [
  ["* * * * *", "Каждую минуту"],
  ["*/5 * * * *", "Каждые 5 минут"],
  ["*/15 * * * *", "Каждые 15 минут"],
  ["*/30 * * * *", "Каждые 30 минут"],
  ["0 * * * *", "Каждый час"],
  ...[2, 3, 6, 12].map((n) => [`0 */${n} * * *`, `Каждые ${n} ч`]),
] as const

const labelCls = "grid gap-1.5 text-sm font-bold text-muted-foreground"

/** A custom item's cron, posted as its `time`, with presets and a preview of the next runs. */
export function CronField({
  defaultValue,
  timezone,
  startDate,
}: {
  defaultValue: string
  timezone: string
  startDate: string // YYYY-MM-DD: the bot sends nothing before it
}) {
  const [cron, setCron] = useState(defaultValue)
  const valid = !!parseCron(cron)
  const from = Math.max(
    Date.parse(`${nowInZone(timezone).replace(" ", "T")}:00Z`),
    (Date.parse(`${startDate}T00:00:00Z`) || 0) - 60_000 // runs are after `from`
  )
  const runs = nextRuns(cron, new Date(from))
  const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ")
  return (
    <>
      <label className={labelCls}>
        Cron ({timezone})
        <Input
          name="time"
          value={cron}
          onChange={(e) => setCron(e.target.value)}
          required
          maxLength={100}
          placeholder="мин час день месяц день_недели"
          className="font-mono sm:w-40"
        />
      </label>
      <div className="grid gap-1 text-sm sm:order-last sm:col-span-full">
        <Select
          aria-label="Быстрый выбор"
          value=""
          onChange={(e) => setCron(e.target.value)}
          className="sm:w-56"
        >
          <option value="">Быстрый выбор…</option>
          {PRESETS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </Select>
        {valid ? (
          <p className="text-muted-foreground" suppressHydrationWarning>
            {describeCron(cron)}. Ближайшие:{" "}
            {runs.length ? runs.map(fmt).join(", ") : "нет в ближайшие 5 лет"}
          </p>
        ) : (
          <p className="text-destructive">
            Неверный cron: 5 полей — минута час день месяц день_недели
          </p>
        )}
        {runs.length > 1 &&
          runs[1].getTime() - runs[0].getTime() === 60_000 && (
            <p className="text-action">
              Отправка каждую минуту: каждый привязанный чат получит сообщение
              ежеминутно.
            </p>
          )}
      </div>
    </>
  )
}
