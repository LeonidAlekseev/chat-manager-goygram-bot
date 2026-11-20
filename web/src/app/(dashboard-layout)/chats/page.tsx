import Link from "next/link"
import { redirect } from "next/navigation"

import type { Metadata } from "next"

import {
  getViewer,
  isSuper,
  visibleChats,
  visibleSchedules,
} from "@/lib/access"
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
import { NotAdminBadge, NotAdminHint } from "./member-status"

export const metadata: Metadata = { title: "Чаты" }

export default async function ChatsPage() {
  // Layouts are not re-rendered on client navigation, so data pages check the session themselves.
  const v = await getViewer()
  if (!v) redirect("/login")
  const [chats, schedules, scan, me] = await Promise.all([
    db.chat.findMany({
      where: visibleChats(v),
      orderBy: [{ active: "desc" }, { title: "asc" }],
      // the viewer's own admin status only (#99); the superadmin is not assigned, so gets none
      include: {
        managers: {
          where: { managerId: v.id },
          select: { memberStatus: true },
        },
      },
    }),
    db.schedule.findMany({
      where: visibleSchedules(v),
      select: { id: true, name: true },
    }),
    isSuper(v) ? discoveryView() : null,
    db.manager.findUnique({
      where: { id: v.id },
      select: { telegramUserId: true },
    }),
  ])
  // an unlinked manager's statuses are of an old account or none: not shown
  const linked = !!me?.telegramUserId
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
          {!isSuper(v) &&
            chats.some(
              (c) =>
                !linked ||
                ["member", "absent"].includes(c.managers[0]?.memberStatus ?? "")
            ) && <NotAdminHint linked={linked} />}
          {chats.length === 0 ? (
            <p className="text-muted-foreground">
              Добавьте бота в группу — чат появится здесь.
            </p>
          ) : (
            // one markup: a card per chat on a phone, table-like columns from md up
            <div className="grid text-sm">
              <div className="hidden gap-4 py-2 font-medium text-muted-foreground md:grid md:grid-cols-[minmax(0,2fr)_auto_auto_minmax(0,1fr)_auto]">
                <span>Название</span>
                <span>Telegram ID</span>
                <span>Статус</span>
                <span>Расписание</span>
                <span />
              </div>
              {chats.map((chat) => (
                <div
                  key={chat.id}
                  className="relative grid gap-2 border-t py-3 pr-12 md:pr-0 md:grid-cols-[minmax(0,2fr)_auto_auto_minmax(0,1fr)_auto] md:items-center md:gap-4 md:py-2"
                >
                  <div className="grid min-w-0 gap-1">
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
                        Сохранить
                      </Button>
                    </ActionForm>
                    {linked && (
                      <NotAdminBadge
                        status={chat.managers[0]?.memberStatus ?? null}
                      />
                    )}
                  </div>
                  <span className="font-mono text-muted-foreground md:text-foreground">
                    {chat.telegramId.toString()}
                  </span>
                  <span>
                    {chat.deleting ? (
                      <Badge variant="secondary">Удаляется…</Badge>
                    ) : chat.active ? (
                      <Badge>Активен</Badge>
                    ) : (
                      <Badge variant="secondary">Бот удалён</Badge>
                    )}
                  </span>
                  <span>
                    {!chat.deleting && (
                      <Link
                        href={`/chats/${chat.id}`}
                        className="underline underline-offset-4"
                      >
                        {scheduleName(chat.scheduleId) ||
                          "Настроить расписание"}
                      </Link>
                    )}
                  </span>
                  {!chat.deleting && isSuper(v) && (
                    <DeleteChatForm
                      chat={chat}
                      className="absolute right-0 top-3 md:static"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
