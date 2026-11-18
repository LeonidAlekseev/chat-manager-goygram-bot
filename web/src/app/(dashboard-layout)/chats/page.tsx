import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"

import type { Metadata } from "next"

import { db } from "@/lib/db"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ActionForm } from "@/components/action-form"
import { renameChat } from "./actions"

export const metadata: Metadata = { title: "Чаты" }

export default async function ChatsPage() {
  // Layouts are not re-rendered on client navigation, so data pages check the session themselves.
  if (!(await auth())?.user) redirect("/login")
  const chats = await db.chat.findMany({
    orderBy: [{ active: "desc" }, { title: "asc" }],
    include: { schedule: { select: { name: true } } },
  })

  return (
    <section className="container p-4">
      <Card>
        <CardHeader>
          <CardTitle>Чаты</CardTitle>
        </CardHeader>
        <CardContent>
          {chats.length === 0 ? (
            <p className="text-muted-foreground">
              Добавьте бота в группу — чат появится здесь.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Название</th>
                  <th className="py-2 font-medium">Telegram ID</th>
                  <th className="py-2 font-medium">Статус</th>
                  <th className="py-2 font-medium">Расписание</th>
                </tr>
              </thead>
              <tbody>
                {chats.map((chat) => (
                  <tr key={chat.id} className="border-t">
                    <td className="py-2 pe-4">
                      <ActionForm action={renameChat} className="flex gap-2">
                        <input type="hidden" name="id" value={chat.id} />
                        <Input
                          name="title"
                          defaultValue={chat.title}
                          aria-label={`Название чата ${chat.telegramId}`}
                          required
                          maxLength={255}
                        />
                        <Button type="submit" variant="outline">
                          Сохранить
                        </Button>
                      </ActionForm>
                    </td>
                    <td className="py-2 pe-4 font-mono">
                      {chat.telegramId.toString()}
                    </td>
                    <td className="py-2">
                      {chat.active ? (
                        <Badge>Активен</Badge>
                      ) : (
                        <Badge variant="secondary">Бот удалён</Badge>
                      )}
                    </td>
                    <td className="py-2 ps-4">
                      <Link
                        href={`/chats/${chat.id}`}
                        className="underline underline-offset-4"
                      >
                        {chat.schedule?.name ?? "Настроить"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
