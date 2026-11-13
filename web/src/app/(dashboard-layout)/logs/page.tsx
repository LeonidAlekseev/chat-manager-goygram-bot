import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"

import type { SendStatus } from "@prisma/client"
import type { Metadata } from "next"

import { db } from "@/lib/db"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = { title: "Журнал" }

const STATUS: Record<SendStatus, string> = {
  sent: "Отправлено",
  error: "Ошибка",
  pending: "В процессе",
}

const fmt = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: process.env.TIMEZONE_NAME || "Europe/Moscow",
})

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string; status?: string }>
}) {
  if (!(await auth())) redirect("/login")
  const { chat, status } = await searchParams
  const chatId = Number(chat) || undefined
  const st = status && status in STATUS ? (status as SendStatus) : undefined
  const [chats, logs] = await Promise.all([
    db.chat.findMany({
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    db.sendLog.findMany({
      where: { chatId, status: st },
      orderBy: { id: "desc" },
      take: 200,
      include: {
        chat: { select: { title: true } },
        template: { select: { name: true } },
        outbox: { select: { text: true } },
      },
    }),
  ])

  return (
    <section className="container p-4">
      <Card>
        <CardHeader>
          <CardTitle>Журнал отправок</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form className="flex flex-wrap gap-2">
            <select
              name="chat"
              defaultValue={chatId ?? ""}
              aria-label="Чат"
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Все чаты</option>
              {chats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <select
              name="status"
              defaultValue={st ?? ""}
              aria-label="Статус"
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Все статусы</option>
              {Object.entries(STATUS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline">
              Показать
            </Button>
          </form>
          {logs.length === 0 ? (
            <p className="text-muted-foreground">Отправок пока нет.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Когда</th>
                  <th className="py-2 font-medium">Чат</th>
                  <th className="py-2 font-medium">Шаблон</th>
                  <th className="py-2 font-medium">Статус</th>
                  <th className="py-2 font-medium">Ошибка</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t align-top">
                    <td className="py-2 pe-4 whitespace-nowrap">
                      {fmt.format(l.slot)}
                    </td>
                    <td className="py-2 pe-4">{l.chat.title}</td>
                    <td className="py-2 pe-4" title={l.text ?? undefined}>
                      {l.template?.name ??
                        (l.outbox?.text != null
                          ? "Ручной текст"
                          : "— удалён —")}
                    </td>
                    <td className="py-2 pe-4">
                      <Badge
                        variant={
                          l.status === "error" ? "destructive" : "secondary"
                        }
                      >
                        {STATUS[l.status]}
                      </Badge>
                    </td>
                    <td className="py-2 break-all text-destructive">
                      {l.error}
                      {l.pollId && (
                        <Link
                          href={`/logs/${l.id}`}
                          className="text-foreground underline"
                        >
                          Ответы
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
