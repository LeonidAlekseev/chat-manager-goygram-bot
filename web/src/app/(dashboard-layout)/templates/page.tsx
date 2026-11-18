import { redirect } from "next/navigation"
import { auth } from "@/auth"

import type { Metadata } from "next"

import { db } from "@/lib/db"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DeleteTemplate, TemplateForm } from "./template-form"

export const metadata: Metadata = { title: "Шаблоны" }

// ?id=<id>: the bot's «Открыть в панели» link to a template it just saved.
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  if (!(await auth())?.user) redirect("/login")
  const opened = Number((await searchParams).id)
  const templates = await db.template.findMany({
    orderBy: { id: "asc" },
    include: { author: { select: { name: true, login: true } } },
  })

  return (
    <section className="container grid gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Новый шаблон</CardTitle>
        </CardHeader>
        <CardContent>
          <TemplateForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Шаблоны</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {templates.length === 0 && (
            <p className="text-muted-foreground">Шаблонов пока нет.</p>
          )}
          {templates.map((t) => (
            // the delete form sits beside <details>, not in <summary>: iOS Safari may toggle instead of submit
            <div
              key={t.id}
              className="flex flex-col items-start gap-2 sm:flex-row"
            >
              <details
                id={`t-${t.id}`}
                open={t.id === opened}
                className="w-full min-w-0 rounded-md sm:flex-1 border p-3 open:border-primary"
              >
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  {t.name}
                  <Badge variant="secondary">
                    {t.kind === "poll"
                      ? t.correctOptionId === null
                        ? "Опрос"
                        : "Викторина"
                      : t.mediaType === "album"
                        ? `Альбом, ${t.sourceMessageIds.length} шт.`
                        : t.kind === "copy"
                          ? `Копия · ${t.mediaType}`
                          : "Текст"}
                  </Badge>
                  {t.author && (
                    <span className="text-sm text-muted-foreground">
                      {t.author.name || t.author.login}
                    </span>
                  )}
                </summary>
                <div className="mt-3 grid gap-3">
                  <TemplateForm t={t} />
                </div>
              </details>
              <DeleteTemplate id={t.id} name={t.name} />
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}
