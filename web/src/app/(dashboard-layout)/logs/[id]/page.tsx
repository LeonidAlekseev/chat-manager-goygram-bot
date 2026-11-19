import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import type { Metadata } from "next"

import { getViewer, visibleSends } from "@/lib/access"
import { db } from "@/lib/db"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Voter } from "./voter"

export const metadata: Metadata = { title: "Ответы на опрос" }

export default async function PollAnswersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const v = await getViewer()
  if (!v) redirect("/login")
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) notFound()
  const log = await db.sendLog.findFirst({
    where: { id, ...visibleSends(v) },
    include: { chat: true, template: true },
  })
  if (!log?.pollId) notFound()
  const answers = await db.pollAnswer.findMany({
    where: { pollId: log.pollId },
    orderBy: { updatedAt: "asc" },
  })
  const members = await db.pollMember.findMany({
    where: { pollId: log.pollId },
  })
  const result = await db.pollResult.findUnique({
    where: { pollId: log.pollId },
  })
  // Telegram sends no answers for an anonymous poll, only counts (once someone has voted).
  const anonymous = result?.anonymous ?? log.template?.anonymous ?? false
  // the snapshot taken at send time; rows sent before it existed fall back to the template
  const text = log.text ?? log.template?.text
  const options = log.text != null ? log.options : (log.template?.options ?? [])
  // Retracted votes are kept as rows with no options; they count as "no answer".
  const voted = answers.filter((a) => a.optionIds.length > 0)
  const answeredIds = new Set(voted.map((a) => a.userId))
  // a member who retracted a vote has an answer row with a fresher name than the snapshot's
  const byUser = new Map(answers.map((a) => [a.userId, a]))
  const missing = members.filter((m) => !answeredIds.has(m.userId))

  return (
    <section className="container p-4">
      <Card>
        <CardHeader>
          <CardTitle>{text ?? "Опрос"}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {log.chat.title} ·{" "}
            <Link href="/logs" className="underline">
              назад к журналу
            </Link>
          </p>
        </CardHeader>
        <CardContent className="grid gap-2">
          {anonymous ? (
            <>
              <p className="text-muted-foreground">
                Анонимный опрос — ответы не видны.
              </p>
              {result && (
                <ul className="grid gap-1 text-sm">
                  {options.map((o, i) => (
                    <li key={i}>
                      {o}: <b>{result.counts[i] ?? 0}</b>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : voted.length === 0 ? (
            <p className="text-muted-foreground">Ответов пока нет.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {voted.map((a) => (
                <li key={String(a.userId)} className="min-w-0 break-words">
                  <Voter v={a} />:{" "}
                  {a.optionIds.map((o) => options[o] ?? `#${o + 1}`).join(", ")}
                </li>
              ))}
            </ul>
          )}
          {anonymous ? null : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Список участников чата недоступен — «не ответили» не показываем.
            </p>
          ) : (
            <>
              <h3 className="mt-2 font-medium">
                Не ответили ({missing.length})
              </h3>
              {missing.length === 0 ? (
                <p className="text-sm">—</p>
              ) : (
                <ul className="grid gap-2 text-sm">
                  {missing.map((m) => (
                    <li key={String(m.userId)} className="min-w-0 break-words">
                      <Voter v={byUser.get(m.userId) ?? m} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
