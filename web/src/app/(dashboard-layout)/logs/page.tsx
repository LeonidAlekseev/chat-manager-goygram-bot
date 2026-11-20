import Link from "next/link"
import { redirect } from "next/navigation"
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Filter,
  History,
  LoaderCircle,
} from "lucide-react"

import type { SendStatus } from "@prisma/client"
import type { Metadata } from "next"

import { getViewer, visibleChats, visibleSends } from "@/lib/access"
import { db } from "@/lib/db"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { Empty } from "@/components/empty"
import { rows as t } from "@/components/rows"

export const metadata: Metadata = { title: "Журнал" }

// icon + word, never color alone
const STATUS = {
  sent: { label: "Отправлено", variant: "default", icon: CircleCheck },
  error: { label: "Ошибка", variant: "destructive", icon: CircleAlert },
  pending: { label: "В процессе", variant: "secondary", icon: LoaderCircle },
} as const satisfies Record<SendStatus, unknown>

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
    <section className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle icon={History}>Журнал отправок</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto]">
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
              {Object.entries(STATUS).map(([v, s]) => (
                <option key={v} value={v}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="outline">
              <Filter />
              Показать
            </Button>
          </form>
          {logs.length === 0 ? (
            <Empty>Отправок пока нет.</Empty>
          ) : (
            <table className={t.table}>
              <thead className={t.head}>
                <tr>
                  <th className={t.th}>Когда</th>
                  <th className={t.th}>Чат</th>
                  <th className={t.th}>Шаблон</th>
                  <th className={t.th}>Статус</th>
                  <th className={t.th}>Ошибка</th>
                </tr>
              </thead>
              <tbody className={t.body}>
                {logs.map((l) => {
                  const s = STATUS[l.status]
                  return (
                    <tr key={l.id} className={t.tr}>
                      <td className={t.when}>{fmt.format(l.slot)}</td>
                      <td className={`${t.td} font-bold`}>{l.chat.title}</td>
                      <td className={t.td} title={l.text ?? undefined}>
                        {l.template?.name ??
                          (l.outbox?.text != null
                            ? l.options.length
                              ? "Свой опрос"
                              : "Ручной текст"
                            : "— удалён —")}
                      </td>
                      <td className={t.status}>
                        <Badge variant={s.variant}>
                          <s.icon aria-hidden />
                          {s.label}
                        </Badge>
                      </td>
                      <td
                        className={`${t.td} break-all text-destructive empty:hidden md:empty:table-cell`}
                      >
                        {l.error}
                        {l.pollId && (
                          <Link
                            href={`/logs/${l.id}`}
                            className="inline-flex min-h-11 items-center font-bold text-primary underline underline-offset-4 md:min-h-0"
                          >
                            Ответы
                          </Link>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {rows.length > PAGE && (
            <Button asChild variant="outline" className="w-fit">
              <Link href={`/logs?${next}`}>
                Дальше
                <ChevronRight />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
