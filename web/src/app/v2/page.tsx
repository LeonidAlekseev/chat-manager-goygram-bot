import Link from "next/link"
import { redirect } from "next/navigation"
import {
  CalendarClock,
  Eye,
  FileText,
  History,
  MessagesSquare,
  Send,
} from "lucide-react"

import { getViewer, isSuper } from "@/lib/access"
import { db } from "@/lib/db"
import { cn } from "@/lib/utils"

import { ChatsTab } from "./chats"
import { LogsTab } from "./logs"
import { SchedulesTab } from "./schedules"
import { SendTab } from "./send"
import { TemplatesTab } from "./templates"

const TABS = {
  chats: { label: "Чаты", icon: MessagesSquare, View: ChatsTab },
  templates: { label: "Шаблоны", icon: FileText, View: TemplatesTab },
  schedules: { label: "Расписания", icon: CalendarClock, View: SchedulesTab },
  send: { label: "Отправка", icon: Send, View: SendTab },
  logs: { label: "Журнал", icon: History, View: LogsTab },
}
type Tab = keyof typeof TABS

export const dynamic = "force-dynamic"

// #107: a view-only showcase of the redesign on the viewer's own data; nothing here writes.
export default async function V2Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const v = await getViewer()
  if (!v) redirect("/login")
  const asked = (await searchParams).tab ?? ""
  const tab: Tab = asked in TABS ? (asked as Tab) : "chats"
  const me = await db.manager.findUnique({
    where: { id: v.id },
    select: { name: true, login: true },
  })
  const { label, View } = TABS[tab]

  const nav = (Object.keys(TABS) as Tab[]).map((key) => {
    const { label, icon: Icon } = TABS[key]
    return { key, label, Icon, current: key === tab }
  })

  return (
    <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      {/* desktop rail */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-(--v2-line) bg-(--v2-surface) p-5 lg:flex">
        <Brand />
        <nav aria-label="Разделы" className="grid gap-1">
          {nav.map(({ key, label, Icon, current }) => (
            <Link
              key={key}
              href={`/v2?tab=${key}`}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold text-(--v2-muted) transition-colors duration-150 hover:bg-(--v2-bg) hover:text-(--v2-ink) focus-visible:outline-2 focus-visible:outline-(--v2-primary)",
                current &&
                  "bg-(--v2-primary-soft) text-(--v2-primary) hover:bg-(--v2-primary-soft) hover:text-(--v2-primary)"
              )}
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <Who name={me?.name || me?.login} superadmin={isSuper(v)} />
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-(--v2-line) bg-(--v2-surface)/85 px-4 py-3 backdrop-blur-md lg:hidden">
          <Brand />
        </header>
        <main className="mx-auto grid max-w-6xl gap-4 px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-8 lg:pb-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
                {label}
              </h1>
              <p className="mt-1 text-sm text-(--v2-muted)">
                {isSuper(v) ? "Суперадмин" : "Менеджер"}
                {me && ` · ${me.name || me.login}`}
              </p>
            </div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-(--v2-accent-soft) px-3 py-1 text-xs font-bold text-(--v2-accent)">
              <Eye className="size-3.5" aria-hidden />
              Макет — только просмотр
            </p>
          </div>
          <View v={v} />
        </main>
      </div>

      {/* phone tab bar: five sections fit, so no "more" menu */}
      <nav
        aria-label="Разделы"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-(--v2-line) bg-(--v2-surface)/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        {nav.map(({ key, label, Icon, current }) => (
          <Link
            key={key}
            href={`/v2?tab=${key}`}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-bold text-(--v2-muted) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--v2-primary)",
              current && "text-(--v2-primary)"
            )}
          >
            <span
              className={cn(
                "grid h-7 w-12 place-items-center rounded-full transition-colors duration-150",
                current && "bg-(--v2-primary-soft)"
              )}
            >
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="max-w-full truncate">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}

function Brand() {
  return (
    <Link
      href="/v2"
      className="flex items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-(--v2-primary)"
    >
      <span className="grid size-9 place-items-center rounded-xl bg-(--v2-primary) text-white">
        <Send className="size-4" aria-hidden />
      </span>
      <span className="text-lg font-black tracking-tight">TaskManager</span>
      <span className="rounded-md bg-(--v2-primary-soft) px-1.5 py-0.5 text-[11px] font-bold text-(--v2-primary)">
        v2
      </span>
    </Link>
  )
}

function Who({ name, superadmin }: { name?: string; superadmin: boolean }) {
  return (
    <div className="mt-auto flex items-center gap-3 rounded-xl bg-(--v2-bg) p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--v2-primary) text-sm font-black text-white uppercase">
        {(name ?? "?").slice(0, 1)}
      </span>
      <span className="min-w-0 text-sm">
        <span className="block truncate font-bold">{name}</span>
        <span className="text-(--v2-muted)">
          {superadmin ? "Суперадмин" : "Менеджер"}
        </span>
      </span>
    </div>
  )
}
