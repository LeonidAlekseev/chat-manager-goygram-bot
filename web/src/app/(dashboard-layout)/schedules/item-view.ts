export type ItemView = {
  id?: number // absent for a row not saved yet
  templateId: number
  time: string
  startDate: string // YYYY-MM-DD
  period: string
}

export function toItemView(i: {
  id: number
  templateId: number
  time: string
  startDate: Date
  period: string
}): ItemView {
  return {
    id: i.id,
    templateId: i.templateId,
    time: i.time,
    startDate: i.startDate.toISOString().slice(0, 10),
    period: i.period,
  }
}

/** Timed items by time, then custom ones: as text a cron like `0 * * * *` would sort before 08:00. */
export const byTime = (a: ItemView, b: ItemView) =>
  +(a.period === "custom") - +(b.period === "custom") ||
  (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)

// a plain module: the server page reads the labels too (a "use client" export would arrive as a reference)
export const PERIODS = [
  ["none", "Один раз"],
  ["day", "Каждый день"],
  ["week", "Каждую неделю"],
  ["twoweek", "Раз в две недели"],
  ["month", "Каждый месяц"],
  ["custom", "Своя периодичность (cron)"],
] as const
