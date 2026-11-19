import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { ChevronRight } from "lucide-react"

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
            // the delete form sits over the card, not in <summary>: iOS Safari may toggle instead of submit
            <div key={t.id} className="relative">
              <details
                id={`t-${t.id}`}
                open={t.id === opened}
                className="group w-full min-w-0 rounded-md border p-3 open:border-primary"
              >
                <summary className="flex cursor-pointer list-none items-start gap-2 pr-10 [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    className="mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-90"
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="break-words">{t.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
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
                    </span>
                  </span>
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
