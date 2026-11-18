import { redirect } from "next/navigation"
import { auth } from "@/auth"

import type { Metadata } from "next"

import { TAILS, loadSystemLogs } from "@/lib/systemLogs"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"

export const metadata: Metadata = { title: "Системные логи" }

export default async function SystemLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    container?: string
    tail?: string
    errors?: string
    q?: string
  }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "superadmin") redirect("/chats")
  const params = await searchParams
  const { containers, current, tail, lines, error } =
    await loadSystemLogs(params)

  return (
    <section className="container p-4">
      <Card>
        <CardHeader>
          <CardTitle>Системные логи</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form className="flex flex-wrap items-center gap-2">
            <Select
              name="container"
              defaultValue={current}
              aria-label="Контейнер"
            >
              {containers.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.state})
                </option>
              ))}
            </Select>
            <Select name="tail" defaultValue={tail} aria-label="Строк">
              {TAILS.map((n) => (
                <option key={n} value={n}>
                  {n} строк
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="errors"
                value="1"
                defaultChecked={!!params.errors}
              />
              Только ошибки
            </label>
            <Input
              name="q"
              defaultValue={params.q}
              placeholder="Поиск"
              aria-label="Поиск"
              className="w-48"
            />
            <Button type="submit" variant="outline">
              Обновить
            </Button>
          </form>
          {error ? (
            <p className="text-destructive">{error}</p>
          ) : lines.length === 0 ? (
            <p className="text-muted-foreground">Строк нет.</p>
          ) : (
            // column-reverse opens the block scrolled to the newest lines at the bottom
            <div className="flex max-h-[70vh] flex-col-reverse overflow-auto rounded-md border bg-muted p-2">
              <pre className="font-mono text-xs break-all whitespace-pre-wrap">
                {lines.join("\n")}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
