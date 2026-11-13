export type ItemView = {
  templateId: number
  time: string
  startDate: string // YYYY-MM-DD
  period: string
}

export function toItemView(i: {
  templateId: number
  time: string
  startDate: Date
  period: string
}): ItemView {
  return {
    templateId: i.templateId,
    time: i.time,
    startDate: i.startDate.toISOString().slice(0, 10),
    period: i.period,
  }
}
