import Link from "next/link"
import { redirect } from "next/navigation"

import type { SendStatus } from "@prisma/client"
import type { Metadata } from "next"

import { getViewer, visibleChats, visibleSends } from "@/lib/access"
import { db } from "@/lib/db"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"

export const metadata: Metadata = { title: "Журнал" }

const STATUS: Record<SendStatus, string> = {
  sent: "Отправлено",
  error: "Ошибка",
  pending: "В процессе",
}

const PAGE = 200

// a non-number or an id beyond Postgres INT would make the query throw
const intId = (v?: string) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : undefined
}

const fmt = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: process.env.TIMEZONE_NAME || "Europe/Moscow",
})

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string; status?: string; before?: string }>
}) {
  const v = await getViewer()
  if (!v) redirect("/login")
  const { chat, status, before } = await searchParams
  const chatId = intId(chat)
  const st = status && status in STATUS ? (status as SendStatus) : undefined
  const beforeId = intId(before)
  const [chats, rows] = await Promise.all([
    db.chat.findMany({
      where: visibleChats(v),
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    db.sendLog.findMany({
      where: { chatId, status: st, id: { lt: beforeId }, ...visibleSends(v) },
      orderBy: { id: "desc" },
      take: PAGE + 1, // one extra row tells whether there is a next page
      include: {
        chat: { select: { title: true } },
        template: { select: { name: true } },
        outbox: { select: { text: true } },
      },
    }),
  ])

  const logs = rows.slice(0, PAGE)
  const next = new URLSearchParams()
  if (chatId) next.set("chat", String(chatId))
  if (st) next.set("status", st)
  if (rows.length > PAGE) next.set("before", String(logs[PAGE - 1].id))

  return (
    <section className="container p-4">
      <Card>
        <CardHeader>
          <CardTitle>Журнал отправок</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <form className="flex flex-wrap gap-2">
            <Select
              className="max-w-full"
              name="chat"
              defaultValue={chatId ?? ""}
              aria-label="Чат"
            >
              <option value="">Все чаты</option>
              {chats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
            <Select name="status" defaultValue={st ?? ""} aria-label="Статус">
              <option value="">Все статусы</option>
              {Object.entries(STATUS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="outline">
              Показать
            </Button>
          </form>
          {logs.length === 0 ? (
            <p className="text-muted-foreground">Отправок пока нет.</p>
          ) : (
            <div className="overflow-x-auto">
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
            </div>
          )}
          {rows.length > PAGE && (
            <Button asChild variant="outline" className="w-fit">
              <Link href={`/logs?${next}`}>Дальше</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
