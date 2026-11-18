import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"

import type { Metadata } from "next"

import { db } from "@/lib/db"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = { title: "Ответы на опрос" }

export default async function PollAnswersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await auth())?.user) redirect("/login")
  const id = Number((await params).id)
  if (!Number.isInteger(id)) notFound()
  const log = await db.sendLog.findUnique({
    where: { id },
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
  // the snapshot taken at send time; rows sent before it existed fall back to the template
  const text = log.text ?? log.template?.text
  const options = log.text != null ? log.options : (log.template?.options ?? [])
  // Retracted votes are kept as rows with no options; they count as "no answer".
  const voted = answers.filter((a) => a.optionIds.length > 0)
  const answeredIds = new Set(voted.map((a) => a.userId))
  const names = new Map(answers.map((a) => [a.userId, a.name]))
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
          {voted.length === 0 ? (
            <p className="text-muted-foreground">Ответов пока нет.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {voted.map((a) => (
                <li key={String(a.userId)}>
                  <b>{a.name}</b>:{" "}
                  {a.optionIds.map((o) => options[o] ?? `#${o + 1}`).join(", ")}
                </li>
              ))}
            </ul>
          )}
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Список участников чата недоступен — «не ответили» не показываем.
            </p>
          ) : (
            <>
              <h3 className="mt-2 font-medium">
                Не ответили ({missing.length})
              </h3>
              <p className="text-sm break-words">
                {missing
                  .map((m) => names.get(m.userId) ?? String(m.userId))
                  .join(", ") || "—"}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
