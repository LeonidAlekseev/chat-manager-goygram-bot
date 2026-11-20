import { redirect } from "next/navigation"

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
import { cancelSend } from "./actions"
import { SendForm } from "./send-form"

export const metadata: Metadata = { title: "Отправка" }
export const dynamic = "force-dynamic"

const STATUS: Record<SendStatus | "queued" | "scheduled", string> = {
  scheduled: "Запланировано",
  queued: "В очереди",
  pending: "Отправляется",
  sent: "Отправлено",
  error: "Ошибка",
}

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
      select: { id: true, title: true },
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
    <section className="container grid gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Отправить сообщение</CardTitle>
        </CardHeader>
        <CardContent>
          <SendForm templates={templates} chats={chats} timezone={TIMEZONE} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Последние задания</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-muted-foreground">Заданий пока нет.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 font-medium">Когда</th>
                    <th className="py-2 font-medium">Чат</th>
                    <th className="py-2 font-medium">Что</th>
                    <th className="py-2 font-medium">Статус</th>
                    <th className="py-2 font-medium">Ошибка</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => {
                    const later = !j.sendLog && j.sendAt && j.sendAt > now
                    const status =
                      j.sendLog?.status ?? (later ? "scheduled" : "queued")
                    return (
                      <tr key={j.id} className="border-t align-top">
                        <td className="py-2 pe-4 whitespace-nowrap">
                          {fmt.format(j.sendAt ?? j.createdAt)}
                        </td>
                        <td className="py-2 pe-4">{j.chat.title}</td>
                        <td className="py-2 pe-4">
                          {j.options.length > 0 && "Опрос: "}
                          {j.text ?? j.template?.name ?? "— удалён —"}
                        </td>
                        <td className="py-2 pe-4">
                          <div className="relative flex items-center gap-2">
                            <Badge
                              variant={
                                status === "error" ? "destructive" : "secondary"
                              }
                            >
                              {STATUS[status]}
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
                        <td className="py-2 break-all text-destructive">
                          {j.sendLog?.error}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
