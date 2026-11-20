import { redirect } from "next/navigation"
import {
  ChartBar,
  ChevronRight,
  Copy,
  FileText,
  Images,
  Lock,
  MessageSquareText,
  Plus,
  Trophy,
} from "lucide-react"

import type { Template } from "@prisma/client"
import type { Metadata } from "next"

import { canEdit, getViewer, visibleTemplates } from "@/lib/access"
import { db } from "@/lib/db"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty } from "@/components/empty"
import { DeleteTemplate, TemplateForm } from "./template-form"

export const metadata: Metadata = { title: "Шаблоны" }

function kindOf(t: Template) {
  if (t.kind === "poll")
    return t.correctOptionId === null
      ? { label: "Опрос", icon: ChartBar }
      : { label: "Викторина", icon: Trophy }
  if (t.mediaType === "album")
    return { label: `Альбом, ${t.sourceMessageIds.length} шт.`, icon: Images }
  if (t.kind === "copy") return { label: `Копия · ${t.mediaType}`, icon: Copy }
  return { label: "Текст", icon: MessageSquareText }
}

// ?id=<id>: the bot's «Открыть в панели» link to a template it just saved.
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const v = await getViewer()
  if (!v) redirect("/login")
  const opened = Number((await searchParams).id)
  const templates = await db.template.findMany({
    where: visibleTemplates(v),
    orderBy: { id: "asc" },
    include: { author: { select: { name: true, login: true } } },
  })

  return (
    // the new-template form comes first in the DOM (and on a phone), and sits on the right on a wide screen
    <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="xl:sticky xl:top-8 xl:col-start-2 xl:row-start-1">
        <CardHeader>
          <CardTitle icon={Plus}>Новый шаблон</CardTitle>
        </CardHeader>
        <CardContent>
          <TemplateForm />
        </CardContent>
      </Card>
      <Card className="xl:col-start-1 xl:row-start-1">
        <CardHeader>
          <CardTitle icon={FileText}>Шаблоны · {templates.length}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {templates.length === 0 && <Empty>Шаблонов пока нет.</Empty>}
          {templates.map((t) => {
            const { label, icon: Icon } = kindOf(t)
            return (
              // the delete form sits over the card, not in <summary>: iOS Safari may toggle instead of submit
              <div key={t.id} className="relative">
                <details
                  id={`t-${t.id}`}
                  open={t.id === opened}
                  className="group w-full min-w-0 rounded-xl border bg-card p-4 open:border-primary"
                >
                  <summary className="flex cursor-pointer list-none items-start gap-2 pr-12 [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      className="mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-90"
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block font-bold break-words">
                        {t.name}
                      </span>
                      <span className="mt-1 line-clamp-2 text-sm break-words text-muted-foreground group-open:hidden">
                        {t.text}
                      </span>
                      {t.kind === "poll" && t.options.length > 0 && (
                        // spans: <summary> holds phrasing content; the open form lists the options itself
                        <span
                          role="list"
                          className="mt-2 grid gap-1 text-sm group-open:hidden"
                        >
                          {t.options.map((o, i) => (
                            <span
                              role="listitem"
                              key={i}
                              className="flex min-w-0 items-center gap-2 rounded-lg bg-background px-2 py-1"
                            >
                              <span
                                aria-hidden
                                className="size-3 shrink-0 rounded-full border-2 border-primary"
                              />
                              <span className="min-w-0 break-words">{o}</span>
                              {i === t.correctOptionId && (
                                <Badge className="ml-auto">верный</Badge>
                              )}
                            </span>
                          ))}
                        </span>
                      )}
                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge>
                          <Icon aria-hidden />
                          {label}
                        </Badge>
                        {!canEdit(v, t) && (
                          <Badge
                            variant="secondary"
                            title="Только суперадмин меняет"
                          >
                            <Lock aria-hidden />
                            Неизменяемый
                          </Badge>
                        )}
                        {t.author && (
                          <span className="text-xs text-muted-foreground">
                            Автор: {t.author.name || t.author.login}
                          </span>
                        )}
                      </span>
                    </span>
                  </summary>
                  <div className="mt-3 grid gap-3">
                    <TemplateForm t={t} readOnly={!canEdit(v, t)} />
                  </div>
                </details>
                {canEdit(v, t) && <DeleteTemplate id={t.id} name={t.name} />}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </section>
  )
}
