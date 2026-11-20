import { redirect } from "next/navigation"
import {
  CircleAlert,
  CircleCheck,
  Clock,
  History,
  LoaderCircle,
  Send,
} from "lucide-react"

import type { SendStatus } from "@prisma/client"
import type { Metadata } from "next"

import {
  getViewer,
  visibleChats,
  visibleSends,
  visibleTemplates,
} from "@/lib/access"
import { db } from "@/lib/db"
import { TIMEZONE } from "@/lib/timezone"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DeleteForm } from "@/components/delete-form"
import { Empty } from "@/components/empty"
import { rows as t } from "@/components/rows"
import { cancelSend } from "./actions"
import { SendForm } from "./send-form"

export const metadata: Metadata = { title: "Отправка" }
export const dynamic = "force-dynamic"

// icon + word, never color alone
const STATUS = {
  scheduled: { label: "Запланировано", variant: "action", icon: Clock },
  queued: { label: "В очереди", variant: "secondary", icon: LoaderCircle },
  pending: { label: "Отправляется", variant: "secondary", icon: LoaderCircle },
  sent: { label: "Отправлено", variant: "default", icon: CircleCheck },
  error: { label: "Ошибка", variant: "destructive", icon: CircleAlert },
} as const satisfies Record<SendStatus | "queued" | "scheduled", unknown>

const fmt = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: TIMEZONE,
})

const include = {
  chat: { select: { title: true } },
  template: { select: { name: true } },
  sendLog: { select: { status: true, error: true } },
} as const

export default async function SendPage() {
  const v = await getViewer()
  if (!v) redirect("/login")
  const now = new Date()
  const [templates, chats, scheduled, recent] = await Promise.all([
    db.template.findMany({
      where: visibleTemplates(v),
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.chat.findMany({
      where: { active: true, deleting: false, ...visibleChats(v) },
      orderBy: { title: "asc" },
      select: { id: true, title: true, photo: { select: { uniqueId: true } } },
    }),
    // every scheduled job, however many sends came after it, so it can still be cancelled
    db.outbox.findMany({
      where: { ...visibleSends(v), sendAt: { gt: now }, sendLog: null },
      orderBy: { sendAt: "asc" },
      include,
    }),
    db.outbox.findMany({
      where: visibleSends(v),
      orderBy: { id: "desc" },
      take: 50,
      include,
    }),
  ])
  const ids = new Set(scheduled.map((j) => j.id))
  const jobs = [...scheduled, ...recent.filter((j) => !ids.has(j.id))]

  return (
    <section className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle icon={Send}>Отправить сообщение</CardTitle>
        </CardHeader>
        <CardContent>
          <SendForm templates={templates} chats={chats} timezone={TIMEZONE} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle icon={History}>Последние задания</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <Empty>Заданий пока нет.</Empty>
          ) : (
            <table className={t.table}>
              <thead className={t.head}>
                <tr>
                  <th className={t.th}>Когда</th>
                  <th className={t.th}>Чат</th>
                  <th className={t.th}>Что</th>
                  <th className={t.th}>Статус</th>
                  <th className={t.th}>Ошибка</th>
                </tr>
              </thead>
              <tbody className={t.body}>
                {jobs.map((j) => {
                  const later = !j.sendLog && j.sendAt && j.sendAt > now
                  const status =
                    j.sendLog?.status ?? (later ? "scheduled" : "queued")
                  const s = STATUS[status]
                  return (
                    <tr key={j.id} className={t.tr}>
                      <td className={t.when}>
                        {fmt.format(j.sendAt ?? j.createdAt)}
                      </td>
                      <td className={`${t.td} font-bold`}>{j.chat.title}</td>
                      <td className={t.td}>
                        {j.options.length > 0 && "Опрос: "}
                        {j.text ?? j.template?.name ?? "— удалён —"}
                      </td>
                      <td className={t.status}>
                        <div className="relative flex items-center gap-2">
                          <Badge variant={s.variant}>
                            <s.icon aria-hidden />
                            {s.label}
                          </Badge>
                          {later && (
                            <DeleteForm
                              action={cancelSend}
                              id={j.id}
                              label="Отменить отправку"
                              confirmText="Отменить запланированную отправку?"
                            />
                          )}
                        </div>
                      </td>
                      <td
                        className={`${t.td} break-all text-destructive empty:hidden md:empty:table-cell`}
                      >
                        {j.sendLog?.error}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
