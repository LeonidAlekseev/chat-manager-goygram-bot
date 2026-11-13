import { redirect } from "next/navigation"
import { auth } from "@/auth"

import type { Metadata } from "next"

import { db } from "@/lib/db"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { unlinkTelegram } from "./actions"
import { LinkTelegramForm } from "./link-telegram-form"

export const metadata: Metadata = { title: "Профиль" }

export default async function ProfilePage() {
  const login = (await auth())?.user?.name
  if (!login) redirect("/login")
  const me = await db.manager.findUniqueOrThrow({ where: { login } })

  return (
    <section className="container space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {me.telegramUserId ? (
            <form action={unlinkTelegram} className="flex items-center gap-2">
              <Badge>Привязан</Badge>
              <span className="font-mono">{String(me.telegramUserId)}</span>
              <Button type="submit" variant="outline">
                Отвязать
              </Button>
            </form>
          ) : (
            <Badge variant="secondary">Не привязан</Badge>
          )}
          <LinkTelegramForm />
        </CardContent>
      </Card>
    </section>
  )
}
