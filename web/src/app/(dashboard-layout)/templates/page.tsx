import { redirect } from "next/navigation"
import { auth } from "@/auth"

import type { Metadata } from "next"

import { db } from "@/lib/db"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DeleteTemplate, TemplateForm } from "./template-form"

export const metadata: Metadata = { title: "Шаблоны" }

export default async function TemplatesPage() {
  if (!(await auth())) redirect("/login")
  const templates = await db.template.findMany({ orderBy: { id: "asc" } })

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
            <details key={t.id} className="rounded-md border p-3">
              <summary className="flex cursor-pointer items-center gap-2">
                {t.name}
                <Badge variant="secondary">
                  {t.kind === "poll" ? "Опрос" : "Текст"}
                </Badge>
              </summary>
              <div className="mt-3 grid gap-3">
                <TemplateForm t={t} />
                <DeleteTemplate id={t.id} />
              </div>
            </details>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}
