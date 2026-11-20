import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Search,
  Settings,
  Users,
} from "lucide-react"

import type { Viewer } from "@/lib/access"

import { isSuper, visibleChats, visibleSchedules } from "@/lib/access"
import { chatLink } from "@/lib/chat-link"
import { db } from "@/lib/db"
import { cn } from "@/lib/utils"

import { Empty, MOCK, Pill } from "@/components/v2/ui"

const NOT_ADMIN: Record<string, string> = {
  member: "Вы не администратор",
  absent: "Вас нет в чате",
}

export async function ChatsTab({ v }: { v: Viewer }) {
  const [chats, schedules, me] = await Promise.all([
    db.chat.findMany({
      where: visibleChats(v),
      orderBy: [{ active: "desc" }, { title: "asc" }],
      include: {
        managers: {
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
    db.manager.findUnique({
      where: { id: v.id },
      select: { telegramUserId: true },
    }),
  ])
  const linked = !!me?.telegramUserId
  const scheduleName = (id: number | null) =>
    id &&
    (schedules.find((s) => s.id === id)?.name ?? "Расписание другого менеджера")
  const active = chats.filter((c) => c.active && !c.deleting).length

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Всего чатов" value={chats.length} />
        <Stat label="Бот в чате" value={active} />
        <Stat
          label="Без расписания"
          value={chats.filter((c) => !c.scheduleId).length}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {isSuper(v) && (
        <button
          type="button"
          disabled
          title={MOCK}
          className="inline-flex h-11 w-fit cursor-not-allowed items-center gap-2 rounded-xl border border-(--v2-line) bg-(--v2-surface) px-4 text-sm font-bold text-(--v2-primary)"
        >
          <Search className="size-4" aria-hidden />
          Найти группы бота
        </button>
      )}

      {chats.length === 0 ? (
        <Empty>Добавьте бота в группу — чат появится здесь.</Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {chats.map((chat) => {
            const link = chatLink(chat.telegramId)
            const mine = chat.managers.find((m) => m.managerId === v.id)
            const warn = linked && NOT_ADMIN[mine?.memberStatus ?? ""]
            const off = !chat.active || chat.deleting
            return (
              <li
                key={chat.id}
                data-testid="v2-chat"
                className={cn(
                  "flex min-w-0 flex-col gap-3 rounded-2xl border border-(--v2-line) bg-(--v2-surface) p-4 shadow-[0_1px_2px_rgb(15_46_43/0.06)]",
                  off && "bg-(--v2-bg) shadow-none"
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-xl text-base font-black uppercase",
                      off
                        ? "bg-(--v2-line) text-(--v2-muted)"
                        : "bg-(--v2-primary-soft) text-(--v2-primary)"
                    )}
                  >
                    {chat.title.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold break-words">{chat.title}</h3>
                    <p className="font-mono text-xs text-(--v2-muted) tabular-nums">
                      {chat.telegramId.toString()}
                    </p>
                  </div>
                  {chat.deleting ? (
                    <Pill>Удаляется…</Pill>
                  ) : chat.active ? (
                    <Pill tone="primary" icon={CircleCheck}>
                      Бот в чате
                    </Pill>
                  ) : (
                    <Pill>Бот удалён</Pill>
                  )}
                </div>

                {warn && (
                  <Pill
                    tone="danger"
                    icon={CircleAlert}
                    title="Команды бота, например /all, доступны только администраторам чата"
                  >
                    {warn}
                  </Pill>
                )}

                {!chat.deleting && (
                  <dl className="grid gap-2 text-sm">
                    <Row icon={CalendarClock} label="Расписание">
                      {scheduleName(chat.scheduleId) || (
                        <span className="text-(--v2-muted)">
                          Без расписания
                        </span>
                      )}
                    </Row>
                    {isSuper(v) && (
                      <Row icon={Users} label="Менеджеры">
                        {chat.managers.length > 0 ? (
                          chat.managers
                            .map((m) => m.manager.name || m.manager.login)
                            .join(", ")
                        ) : (
                          <span className="text-(--v2-muted)">
                            Без менеджеров
                          </span>
                        )}
                      </Row>
                    )}
                  </dl>
                )}

                <div className="mt-auto flex items-center gap-2 border-t border-(--v2-line) pt-3">
                  {link ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-bold text-(--v2-primary) underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-(--v2-primary)"
                    >
                      <ExternalLink className="size-4" aria-hidden />
                      Открыть в Telegram
                    </a>
                  ) : (
                    <span className="text-xs text-(--v2-muted)">
                      Ссылки нет — обычная группа
                    </span>
                  )}
                  <button
                    type="button"
                    disabled
                    title={MOCK}
                    aria-label={`Настроить ${chat.title}`}
                    className="ml-auto grid size-11 cursor-not-allowed place-items-center rounded-xl text-(--v2-muted)"
                  >
                    <Settings className="size-5" aria-hidden />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
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
    <div
      className={cn(
        "rounded-2xl border border-(--v2-line) bg-(--v2-surface) p-4",
        className
      )}
    >
      <p className="text-xs font-bold text-(--v2-muted)">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
    </div>
  )
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Users
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-(--v2-muted)" aria-hidden />
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}
