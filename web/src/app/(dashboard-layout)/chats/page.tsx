import Link from "next/link"
import { redirect } from "next/navigation"
import { CalendarClock, ExternalLink, Save, Users } from "lucide-react"

import type { Metadata } from "next"

import {
  getViewer,
  isSuper,
  visibleChats,
  visibleSchedules,
} from "@/lib/access"
import { chatLink } from "@/lib/chat-link"
import { db } from "@/lib/db"
import { discoveryView } from "@/lib/settings"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ActionForm } from "@/components/action-form"
import { renameChat } from "./actions"
import { DeleteChatForm } from "./delete-chat-form"
import { DiscoverChats } from "./discover-chats"

export const metadata: Metadata = { title: "Чаты" }

export default async function ChatsPage() {
  // Layouts are not re-rendered on client navigation, so data pages check the session themselves.
  const v = await getViewer()
  if (!v) redirect("/login")
  const [chats, schedules, scan] = await Promise.all([
    db.chat.findMany({
      where: visibleChats(v),
      orderBy: [{ active: "desc" }, { title: "asc" }],
      include: {
        managers: {
          select: { manager: { select: { name: true, login: true } } },
        },
      },
    }),
    db.schedule.findMany({
      where: visibleSchedules(v),
      select: { id: true, name: true },
    }),
    isSuper(v) ? discoveryView() : null,
  ])
  const scheduleName = (id: number | null) =>
    id &&
    (schedules.find((s) => s.id === id)?.name ?? "Расписание другого менеджера")

  return (
    <section className="container p-4">
      <Card>
        <CardHeader>
          <CardTitle>Чаты</CardTitle>
        </CardHeader>
        <CardContent>
          {isSuper(v) && <DiscoverChats scan={scan} />}
          {chats.length === 0 ? (
            <p className="text-muted-foreground">
              Добавьте бота в группу — чат появится здесь.
            </p>
          ) : (
            // one markup: a card per chat on a phone, table-like columns from md up
            <div className="grid text-sm">
              <div className="hidden gap-4 py-2 font-medium text-muted-foreground md:grid md:grid-cols-[minmax(0,2fr)_auto_minmax(0,1fr)_auto]">
                <span>Название</span>
                <span>Telegram ID · Статус</span>
                <span>Расписание</span>
                <span />
              </div>
              {chats.map((chat) => {
                const link = chatLink(chat.telegramId)
                return (
                  <div
                    key={chat.id}
                    className="relative grid gap-2 border-t py-3 pr-12 md:pr-0 md:grid-cols-[minmax(0,2fr)_auto_minmax(0,1fr)_auto] md:items-center md:gap-4 md:py-2"
                  >
                    <ActionForm action={renameChat} className="flex gap-2">
                      <input type="hidden" name="id" value={chat.id} />
                      <Input
                        className="min-w-0"
                        name="title"
                        defaultValue={chat.title}
                        aria-label={`Название чата ${chat.telegramId}`}
                        required
                        maxLength={255}
                      />
                      <Button type="submit" variant="outline">
                        <Save />
                        Сохранить
                      </Button>
                    </ActionForm>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 whitespace-nowrap">
                      <span className="font-mono text-muted-foreground md:text-foreground">
                        {chat.telegramId.toString()}
                      </span>
                      <span aria-hidden>·</span>
                      {chat.deleting ? (
                        <Badge variant="secondary">Удаляется…</Badge>
                      ) : chat.active ? (
                        <Badge>Активен</Badge>
                      ) : (
                        <Badge variant="secondary">Бот удалён</Badge>
                      )}
                    </span>
                    {chat.deleting ? (
                      <span />
                    ) : (
                      <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <Link
                          href={`/chats/${chat.id}`}
                          className="inline-flex items-center gap-1 whitespace-nowrap underline underline-offset-4"
                        >
                          <CalendarClock className="size-4" aria-hidden />
                          {scheduleName(chat.scheduleId) ||
                            "Настроить расписание"}
                        </Link>
                        {isSuper(v) && (
                          <Link
                            href={`/chats/${chat.id}#managers`}
                            className="inline-flex items-center gap-1 whitespace-nowrap underline underline-offset-4"
                          >
                            <Users className="size-4" aria-hidden />
                            Настроить менеджеров
                          </Link>
                        )}
                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 whitespace-nowrap underline underline-offset-4"
                          >
                            <ExternalLink className="size-4" aria-hidden />
                            Открыть в Telegram
                          </a>
                        )}
                        {isSuper(v) && chat.managers.length > 0 && (
                          <span className="basis-full text-xs text-muted-foreground">
                            {chat.managers
                              .map((m) => m.manager.name || m.manager.login)
                              .join(", ")}
                          </span>
                        )}
                      </span>
                    )}
                    {!chat.deleting && isSuper(v) && (
                      <DeleteChatForm
                        chat={chat}
                        className="absolute right-0 top-3 md:static"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
