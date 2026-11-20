import Link from "next/link"
import { redirect } from "next/navigation"
import {
  CalendarClock,
  CircleCheck,
  CircleSlash,
  ExternalLink,
  LoaderCircle,
  Save,
  Settings,
  Users,
} from "lucide-react"

import type { LucideIcon } from "lucide-react"
import type { Metadata } from "next"
import type { ReactNode } from "react"

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
import { Input } from "@/components/ui/input"
import { ActionForm } from "@/components/action-form"
import { ChatAvatar } from "@/components/chat-avatar"
import { Empty } from "@/components/empty"
import { renameChat } from "./actions"
import { DeleteChatForm } from "./delete-chat-form"
import { DiscoverChats } from "./discover-chats"
import { NotAdminBadge, NotAdminHint } from "./member-status"

export const metadata: Metadata = { title: "Чаты" }

function ConfigureLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="icon" className="shrink-0">
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

  const live = chats.filter((c) => c.active && !c.deleting)

  return (
    <section className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Всего чатов" value={chats.length} />
        <Stat label="Бот в чате" value={live.length} />
        <Stat
          label="Без расписания"
          value={live.filter((c) => !c.scheduleId).length}
          className="col-span-2 sm:col-span-1"
        />
      </div>
      {isSuper(v) && <DiscoverChats scan={scan} />}
      {!isSuper(v) &&
        chats.some(
          (c) => !linked || ["member", "absent"].includes(myStatus(c) ?? "")
        ) && <NotAdminHint linked={linked} />}
      {chats.length === 0 ? (
        <Empty>Добавьте бота в группу — чат появится здесь.</Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {chats.map((chat) => {
            const link = chatLink(chat.telegramId)
            const off = !chat.active || chat.deleting
            return (
              <li
                key={chat.id}
                title={chat.active ? undefined : "Бот удалён из чата"}
                className={cn(
                  "flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 text-sm shadow-[0_1px_2px_rgb(15_46_43/0.06)]",
                  off && "bg-background shadow-none"
                )}
              >
                <div className="grid min-w-0 gap-1">
                  <ActionForm
                    action={renameChat}
                    className="flex items-center gap-2"
                  >
                    <ChatAvatar
                      chat={{
                        id: chat.id,
                        title: chat.title,
                        photo: chat.photo,
                      }}
                      className={cn(
                        "size-11 rounded-xl text-base",
                        off && "bg-border text-muted-foreground grayscale"
                      )}
                    />
                    <input type="hidden" name="id" value={chat.id} />
                    <Input
                      className="min-w-0 font-bold"
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
                  <span className="ps-13 font-mono text-xs text-muted-foreground tabular-nums">
                    {chat.telegramId.toString()}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {chat.deleting ? (
                    <Badge variant="secondary">
                      <LoaderCircle aria-hidden />
                      Удаляется…
                    </Badge>
                  ) : chat.active ? (
                    <Badge>
                      <CircleCheck aria-hidden />
                      Бот в чате
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <CircleSlash aria-hidden />
                      Бот удалён
                    </Badge>
                  )}
                  {linked && <NotAdminBadge status={myStatus(chat)} />}
                </div>
                {!chat.deleting && (
                  <dl className="grid gap-1">
                    <Row icon={CalendarClock} label="Расписание">
                      {scheduleName(chat.scheduleId) || (
                        <span className="text-muted-foreground">
                          Без расписания
                        </span>
                      )}
                      <ConfigureLink
                        href={`/chats/${chat.id}#schedule`}
                        label={`Настроить расписание ${chat.telegramId}`}
                      />
                    </Row>
                    {isSuper(v) && (
                      <Row icon={Users} label="Менеджеры">
                        {chat.managers.length > 0 ? (
                          chat.managers
                            .map((m) => m.manager.name || m.manager.login)
                            .join(", ")
                        ) : (
                          <span className="text-muted-foreground">
                            Без менеджеров
                          </span>
                        )}
                        <ConfigureLink
                          href={`/chats/${chat.id}#managers`}
                          label={`Настроить менеджеров ${chat.telegramId}`}
                        />
                      </Row>
                    )}
                  </dl>
                )}
                <div className="mt-auto flex min-h-11 items-center gap-2 border-t pt-3">
                  {link ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg font-bold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <ExternalLink className="size-4" aria-hidden />
                      Открыть в Telegram
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Ссылки нет — обычная группа
                    </span>
                  )}
                  {!chat.deleting && isSuper(v) && (
                    <DeleteChatForm chat={chat} className="relative ml-auto" />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Stat({
  label,
  value,
  className,
}: {
  label: string
  value: number
  className?: string
}) {
  return (
    <div className={cn("rounded-2xl border bg-card p-4", className)}>
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
    </div>
  )
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <dt className="sr-only">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center justify-between gap-1 break-words">
        {children}
      </dd>
    </div>
  )
}
