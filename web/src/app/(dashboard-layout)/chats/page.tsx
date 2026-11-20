import Link from "next/link"
import { redirect } from "next/navigation"
import {
  CalendarClock,
  ExternalLink,
  Save,
  Settings,
  Users,
} from "lucide-react"

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
import { cn } from "@/lib/utils"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ActionForm } from "@/components/action-form"
import { ChatAvatar } from "@/components/chat-avatar"
import { renameChat } from "./actions"
import { DeleteChatForm } from "./delete-chat-form"
import { DiscoverChats } from "./discover-chats"
import { NotAdminBadge, NotAdminHint } from "./member-status"

export const metadata: Metadata = { title: "Чаты" }

function ConfigureLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="icon" className="size-8 shrink-0">
      <Link href={href} aria-label={label} title="Настроить">
        <Settings className="size-4" aria-hidden />
      </Link>
    </Button>
  )
}

export default async function ChatsPage() {
  // Layouts are not re-rendered on client navigation, so data pages check the session themselves.
  const v = await getViewer()
  if (!v) redirect("/login")
  const [chats, schedules, scan, me] = await Promise.all([
    db.chat.findMany({
      where: visibleChats(v),
      orderBy: [{ active: "desc" }, { title: "asc" }],
      include: {
        photo: { select: { uniqueId: true } },
        managers: {
          // a manager gets only their own row: their admin status (#99)
          where: isSuper(v) ? {} : { managerId: v.id },
          select: {
            managerId: true,
            memberStatus: true,
            manager: { select: { name: true, login: true } },
          },
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
  const myStatus = (chat: (typeof chats)[number]) =>
    chat.managers.find((m) => m.managerId === v.id)?.memberStatus ?? null
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
              (c) => !linked || ["member", "absent"].includes(myStatus(c) ?? "")
            ) && <NotAdminHint linked={linked} />}
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
                    title={chat.active ? undefined : "Бот удалён из чата"}
                    className={cn(
                      "relative grid gap-2 border-t py-3 pr-12 md:pr-0 md:grid-cols-[minmax(0,2fr)_auto_minmax(0,1fr)_auto] md:items-center md:gap-4 md:py-2",
                      !chat.active && "opacity-50"
                    )}
                  >
                    <div className="grid min-w-0 gap-1">
                      <ActionForm
                        action={renameChat}
                        className="flex items-center gap-2"
                      >
                        <ChatAvatar chat={chat} className="size-9" />
                        <input type="hidden" name="id" value={chat.id} />
                        <Input
                          className="min-w-0"
                          name="title"
                          defaultValue={chat.title}
                          aria-label={`Название чата ${chat.telegramId}`}
                          required
                          maxLength={255}
                        />
                        <Button
                          type="submit"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          aria-label={`Сохранить название ${chat.telegramId}`}
                          title="Сохранить"
                        >
                          <Save />
                        </Button>
                      </ActionForm>
                      {linked && <NotAdminBadge status={myStatus(chat)} />}
                    </div>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 whitespace-nowrap">
                      <span className="font-mono text-muted-foreground md:text-foreground">
                        {chat.telegramId.toString()}
                      </span>
                      {chat.deleting ? (
                        <Badge variant="secondary">Удаляется…</Badge>
                      ) : (
                        !chat.active && (
                          <Badge variant="secondary">Бот удалён</Badge>
                        )
                      )}
                    </span>
                    {chat.deleting ? (
                      <span />
                    ) : (
                      <span className="grid min-w-0 gap-1">
                        <span className="flex min-w-0 items-center gap-1">
                          <CalendarClock
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <span className="min-w-0 break-words">
                            {scheduleName(chat.scheduleId) || "Без расписания"}
                          </span>
                          <ConfigureLink
                            href={`/chats/${chat.id}#schedule`}
                            label={`Настроить расписание ${chat.telegramId}`}
                          />
                        </span>
                        {isSuper(v) && (
                          <span className="flex min-w-0 items-center gap-1">
                            <Users
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden
                            />
                            <span className="min-w-0 break-words">
                              {chat.managers.length > 0
                                ? chat.managers
                                    .map(
                                      (m) => m.manager.name || m.manager.login
                                    )
                                    .join(", ")
                                : "Без менеджеров"}
                            </span>
                            <ConfigureLink
                              href={`/chats/${chat.id}#managers`}
                              label={`Настроить менеджеров ${chat.telegramId}`}
                            />
                          </span>
                        )}
                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 whitespace-nowrap text-xs underline underline-offset-4"
                          >
                            <ExternalLink className="size-4" aria-hidden />
                            Открыть в Telegram
                          </a>
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
