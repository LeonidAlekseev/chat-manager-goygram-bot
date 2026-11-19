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

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SendForm } from "./send-form"

export const metadata: Metadata = { title: "Отправка" }
export const dynamic = "force-dynamic"

const STATUS: Record<SendStatus | "queued", string> = {
  queued: "В очереди",
  pending: "Отправляется",
  sent: "Отправлено",
  error: "Ошибка",
}

const fmt = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: process.env.TIMEZONE_NAME || "Europe/Moscow",
})

export default async function SendPage() {
  const v = await getViewer()
  if (!v) redirect("/login")
  const [templates, chats, jobs] = await Promise.all([
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
    db.outbox.findMany({
      where: visibleSends(v),
      orderBy: { id: "desc" },
      take: 50,
      include: {
        chat: { select: { title: true } },
        template: { select: { name: true } },
        sendLog: { select: { status: true, error: true } },
      },
    }),
  ])

  return (
    <section className="container grid gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Отправить сейчас</CardTitle>
        </CardHeader>
        <CardContent>
          <SendForm templates={templates} chats={chats} />
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
                    const status = j.sendLog?.status ?? "queued"
                    return (
                      <tr key={j.id} className="border-t align-top">
                        <td className="py-2 pe-4 whitespace-nowrap">
                          {fmt.format(j.createdAt)}
                        </td>
                        <td className="py-2 pe-4">{j.chat.title}</td>
                        <td className="py-2 pe-4">
                          {j.text ?? j.template?.name ?? "— удалён —"}
                        </td>
                        <td className="py-2 pe-4">
                          <Badge
                            variant={
                              status === "error" ? "destructive" : "secondary"
                            }
                          >
                            {STATUS[status]}
                          </Badge>
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
