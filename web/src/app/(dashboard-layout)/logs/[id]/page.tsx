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
  if (!(await auth())) redirect("/login")
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
  const options = log.template?.options ?? []
  // Retracted votes are kept as rows with no options; they count as "no answer".
  const voted = answers.filter((a) => a.optionIds.length > 0)

  return (
    <section className="container p-4">
      <Card>
        <CardHeader>
          <CardTitle>{log.template?.text ?? "Опрос"}</CardTitle>
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
          <p className="text-sm text-muted-foreground">
            Список участников чата недоступен — «не ответили» не показываем.
          </p>
        </CardContent>
      </Card>
    </section>
  )
}
