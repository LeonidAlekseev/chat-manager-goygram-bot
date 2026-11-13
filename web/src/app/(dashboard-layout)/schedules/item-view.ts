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
