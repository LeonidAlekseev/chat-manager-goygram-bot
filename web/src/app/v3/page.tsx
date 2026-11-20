import Link from "next/link"
import { redirect } from "next/navigation"
import {
  CalendarClock,
  ExternalLink,
  FileText,
  ListChecks,
  MessageSquare,
  Plus,
  ScrollText,
  Send,
  Users,
} from "lucide-react"

import s from "./v3.module.css"

import type { Tone } from "@/components/v3/ui"
import type { SendStatus } from "@prisma/client"
import type { Metadata } from "next"

import {
  getViewer,
  isSuper,
  visibleChats,
  visibleSchedules,
  visibleSends,
  visibleTemplates,
} from "@/lib/access"
import { chatLink } from "@/lib/chat-link"
import { db } from "@/lib/db"
import { TIMEZONE } from "@/lib/timezone"
import { cn } from "@/lib/utils"

import { Empty, FieldLabel, Pill, Section } from "@/components/v3/ui"

export const metadata: Metadata = { title: "Редизайн v3" }
export const dynamic = "force-dynamic"

const NAV = [
  ["chats", "Чаты", MessageSquare],
  ["templates", "Шаблоны", FileText],
  ["schedules", "Расписания", CalendarClock],
  ["send", "Отправка", Send],
  ["logs", "Журнал", ScrollText],
] as const

const PERIOD: Record<string, string> = {
  none: "Один раз",
  day: "Каждый день",
  week: "Каждую неделю",
  twoweek: "Раз в две недели",
  month: "Каждый месяц",
  custom: "Cron",
}

const STATUS: Record<SendStatus, [string, Tone]> = {
  sent: ["Отправлено", "ok"],
  error: ["Ошибка", "bad"],
  pending: ["В процессе", "wait"],
}

const fmt = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: TIMEZONE,
})

function kindLabel(t: {
  kind: string
  correctOptionId: number | null
  mediaType: string | null
  sourceMessageIds: bigint[]
}) {
  if (t.kind === "poll")
    return t.correctOptionId === null ? "Опрос" : "Викторина"
  if (t.mediaType === "album") return `Альбом · ${t.sourceMessageIds.length}`
  return t.kind === "copy" ? `Копия · ${t.mediaType}` : "Текст"
}

// A read-only showcase (#108): the same queries and scopes as the real pages, every control disabled.
export default async function V3Page() {
  const v = await getViewer()
  if (!v) redirect("/login")
  const [me, chats, templates, schedules, logs] = await Promise.all([
    db.manager.findUnique({
      where: { id: v.id },
      select: { name: true, login: true },
    }),
    db.chat.findMany({
      where: visibleChats(v),
      orderBy: [{ active: "desc" }, { title: "asc" }],
      include: {
        managers: {
          where: isSuper(v) ? {} : { managerId: v.id },
          select: { manager: { select: { name: true, login: true } } },
        },
      },
    }),
    db.template.findMany({
      where: visibleTemplates(v),
      orderBy: { name: "asc" },
      include: { author: { select: { name: true, login: true } } },
    }),
    db.schedule.findMany({
      where: visibleSchedules(v),
      orderBy: { name: "asc" },
      include: {
        items: { orderBy: { time: "asc" } },
      },
    }),
    db.sendLog.findMany({
      where: visibleSends(v),
      orderBy: { id: "desc" },
      take: 30,
      include: {
        chat: { select: { title: true } },
        template: { select: { name: true } },
        outbox: { select: { text: true } },
      },
    }),
  ])
  const sendable = chats.filter((c) => c.active && !c.deleting)
  const errors = logs.filter((l) => l.status === "error").length

  return (
    <div className={cn(s.root, "w-full font-lato")}>
      {/* mobile: a sticky bar with the sections as a scrolling strip; desktop: a left rail */}
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--bg)]/95 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 pt-3">
          <span className="text-lg font-black tracking-tight">TaskManager</span>
          <Link href="/chats" className="text-sm text-[var(--accent)]">
            Текущая панель
          </Link>
        </div>
        <nav
          aria-label="Разделы"
          // contain: the strip scrolls inside, its width never widens the page
          className="overflow-x-auto [contain:inline-size]"
        >
          <ul className="flex w-max gap-1 px-2 py-2">
            {NAV.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="block rounded-full px-3 py-1.5 text-sm font-bold text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <div className="mx-auto grid max-w-[1320px] grid-cols-[minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)] md:gap-10 md:px-8">
        <aside className="hidden md:block">
          <div className="sticky top-0 flex h-dvh flex-col py-8">
            <span className="text-xl font-black tracking-tight">
              TaskManager
            </span>
            <span className="mt-1 text-sm text-[var(--muted)]">
              {me?.name || me?.login} · {isSuper(v) ? "суперадмин" : "менеджер"}
            </span>
            <nav aria-label="Разделы" className="mt-8">
              <ul className="grid gap-1">
                {NAV.map(([id, label, Icon]) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-bold text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--ink)]"
                    >
                      <Icon className="size-4" aria-hidden />
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <Link
              href="/chats"
              className={cn(
                s.navLink,
                "mt-auto w-fit text-sm text-[var(--accent)]"
              )}
            >
              Вернуться в текущую панель
            </Link>
          </div>
        </aside>

        <main className="min-w-0 px-4 py-8 md:px-0">
          <div className="mb-10 grid gap-6 rounded-[var(--radius)] bg-[var(--ink)] p-6 text-white md:p-8">
            <div>
              <p className="text-sm text-white/60">
                Макет для выбора стиля · только просмотр
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight md:text-[40px] md:leading-tight">
                Рассылки в Telegram-чаты
              </h1>
            </div>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 md:grid-cols-4">
              {(
                [
                  ["Чатов с ботом", sendable.length],
                  ["Шаблонов", templates.length],
                  ["Расписаний", schedules.length],
                  ["Ошибок в последних 30", errors],
                ] as const
              ).map(([label, n]) => (
                <div key={label} className="bg-[var(--ink)] p-4">
                  <dt className="text-xs text-white/60">{label}</dt>
                  <dd className="mt-1 text-3xl font-black">{n}</dd>
                </div>
              ))}
            </dl>
          </div>

          <Section
            id="chats"
            title="Чаты"
            count={chats.length}
            lead="Группы, где работает бот. У каждого чата одно расписание."
          >
            {chats.length === 0 ? (
              <Empty>Добавьте бота в группу — чат появится здесь.</Empty>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {chats.map((c) => {
                  const link = chatLink(c.telegramId)
                  const gone = !c.active || c.deleting
                  return (
                    <li
                      key={c.id}
                      className={cn(
                        s.card,
                        "flex min-w-0 flex-col gap-3 p-4",
                        gone && "opacity-60"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="min-w-0 text-[17px] font-bold [overflow-wrap:anywhere]">
                          {c.title}
                        </h3>
                        {c.deleting ? (
                          <Pill tone="wait">Удаляется</Pill>
                        ) : c.active ? (
                          <Pill tone="ok">Активен</Pill>
                        ) : (
                          <Pill>Бот удалён</Pill>
                        )}
                      </div>
                      <span className="font-mono text-xs text-[var(--muted)]">
                        {c.telegramId.toString()}
                      </span>
                      <dl className="grid gap-2 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <dt>
                            <CalendarClock
                              className="size-4 text-[var(--muted)]"
                              aria-label="Расписание"
                            />
                          </dt>
                          <dd className="min-w-0 [overflow-wrap:anywhere]">
                            {c.scheduleId
                              ? (schedules.find((x) => x.id === c.scheduleId)
                                  ?.name ?? "Расписание другого менеджера")
                              : "Без расписания"}
                          </dd>
                        </div>
                        {isSuper(v) && (
                          <div className="flex min-w-0 items-center gap-2">
                            <dt>
                              <Users
                                className="size-4 text-[var(--muted)]"
                                aria-label="Менеджеры"
                              />
                            </dt>
                            <dd className="min-w-0 [overflow-wrap:anywhere]">
                              {c.managers.length
                                ? c.managers
                                    .map(
                                      (m) => m.manager.name || m.manager.login
                                    )
                                    .join(", ")
                                : "Без менеджеров"}
                            </dd>
                          </div>
                        )}
                      </dl>
                      {link && (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            s.navLink,
                            "mt-auto inline-flex w-fit items-center gap-1.5 text-sm font-bold text-[var(--accent)]"
                          )}
                        >
                          <ExternalLink className="size-4" aria-hidden />
                          Открыть в Telegram
                        </a>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>

          <Section
            id="templates"
            title="Шаблоны"
            count={templates.length}
            lead="Готовые сообщения и опросы для расписаний и ручной отправки."
          >
            {templates.length === 0 ? (
              <Empty>Шаблонов пока нет.</Empty>
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {templates.map((t) => (
                  <li key={t.id} className={cn(s.card, "min-w-0 p-4")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={t.kind === "poll" ? "ok" : "plain"}>
                        {t.kind === "poll" ? (
                          <ListChecks className="size-3.5" aria-hidden />
                        ) : (
                          <FileText className="size-3.5" aria-hidden />
                        )}
                        {kindLabel(t)}
                      </Pill>
                      {t.author && (
                        <span className="text-xs text-[var(--muted)]">
                          {t.author.name || t.author.login}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-2 text-[17px] font-bold [overflow-wrap:anywhere]">
                      {t.name}
                    </h3>
                    <p className="mt-1 line-clamp-3 text-[15px] [overflow-wrap:anywhere] whitespace-pre-line text-[var(--muted)]">
                      {t.text}
                    </p>
                    {t.options.length > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-1.5">
                        {t.options.map((o, i) => (
                          <li
                            key={i}
                            className={cn(
                              "max-w-full rounded-md border px-2 py-0.5 text-sm [overflow-wrap:anywhere]",
                              i === t.correctOptionId
                                ? "border-[var(--accent)] text-[var(--accent)]"
                                : "border-[var(--line)]"
                            )}
                          >
                            {o}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            id="schedules"
            title="Расписания"
            count={schedules.length}
            lead="Что и когда бот отправит в привязанные чаты. Время — по зоне панели."
          >
            <div className="grid gap-4">
              {schedules.length === 0 && <Empty>Расписаний пока нет.</Empty>}
              {schedules.map((sc) => (
                <form key={sc.id} className={cn(s.card, "min-w-0 p-4 md:p-6")}>
                  <fieldset disabled className="grid min-w-0 gap-4">
                    <div className="flex flex-wrap items-end gap-3">
                      <FieldLabel label="Название" className="flex-1">
                        <input className={s.field} defaultValue={sc.name} />
                      </FieldLabel>
                      <Pill>
                        чатов:{" "}
                        {chats.filter((c) => c.scheduleId === sc.id).length}
                      </Pill>
                    </div>
                    <ol className="grid gap-2">
                      {sc.items.length === 0 && (
                        <li className="text-sm text-[var(--muted)]">
                          В расписании нет пунктов.
                        </li>
                      )}
                      {sc.items.map((it, i) => (
                        <li
                          key={it.id}
                          className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-xl bg-[var(--surface)] p-3 md:grid-cols-[28px_minmax(0,2fr)_140px_160px_minmax(0,1fr)] md:items-end"
                        >
                          <span className="row-span-4 grid size-7 place-items-center rounded-full bg-[var(--card)] font-mono text-xs font-bold md:row-span-1 md:mb-1.5">
                            {i + 1}
                          </span>
                          <FieldLabel label="Шаблон">
                            <select
                              className={s.field}
                              defaultValue={it.templateId}
                            >
                              <option value={it.templateId}>
                                {/* a superadmin schedule may hold another manager's template: no name */}
                                {templates.find((t) => t.id === it.templateId)
                                  ?.name ?? "Шаблон другого менеджера"}
                              </option>
                            </select>
                          </FieldLabel>
                          <FieldLabel
                            label={it.period === "custom" ? "Cron" : "Время"}
                          >
                            <input
                              className={cn(s.field, "font-mono")}
                              defaultValue={it.time}
                            />
                          </FieldLabel>
                          <FieldLabel label="С даты">
                            <input
                              type="date"
                              className={s.field}
                              defaultValue={it.startDate
                                .toISOString()
                                .slice(0, 10)}
                            />
                          </FieldLabel>
                          <FieldLabel label="Повтор">
                            <select
                              className={s.field}
                              defaultValue={it.period}
                            >
                              {Object.entries(PERIOD).map(([k, label]) => (
                                <option key={k} value={k}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </FieldLabel>
                        </li>
                      ))}
                    </ol>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={cn(s.btn, s.btnGhost)}>
                        <Plus className="size-4" aria-hidden />
                        Добавить пункт
                      </button>
                      <button type="submit" className={s.btn}>
                        Сохранить расписание
                      </button>
                    </div>
                  </fieldset>
                </form>
              ))}
            </div>
          </Section>

          <Section
            id="send"
            title="Отправить сообщение"
            lead="Разовая отправка шаблона, текста или опроса — сейчас или в назначенное время."
          >
            <form className={cn(s.card, "p-4 md:p-6")}>
              <fieldset
                disabled
                className="grid min-w-0 gap-5 md:grid-cols-2 md:gap-8"
              >
                <div className="grid min-w-0 content-start gap-4">
                  <div
                    role="radiogroup"
                    aria-label="Что отправить"
                    className="grid grid-cols-3 rounded-xl bg-[var(--surface)] p-1 text-sm font-bold"
                  >
                    {["Шаблон", "Текст", "Опрос"].map((m, i) => (
                      <label
                        key={m}
                        className={cn(
                          "rounded-lg py-2 text-center",
                          i === 0
                            ? "bg-[var(--card)] shadow-sm"
                            : "text-[var(--muted)]"
                        )}
                      >
                        <input
                          type="radio"
                          name="mode"
                          className="sr-only"
                          defaultChecked={i === 0}
                        />
                        {m}
                      </label>
                    ))}
                  </div>
                  <FieldLabel label="Шаблон">
                    <select className={s.field} defaultValue="">
                      <option value="">— выберите шаблон —</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </FieldLabel>
                  <FieldLabel label={`Когда · ${TIMEZONE}`}>
                    <input type="datetime-local" className={s.field} />
                  </FieldLabel>
                </div>
                <fieldset className="grid min-w-0 content-start gap-2">
                  <legend className="mb-1.5 text-xs font-bold tracking-wide text-[var(--muted)] uppercase">
                    Чаты
                  </legend>
                  {sendable.length === 0 && (
                    <p className="text-sm text-[var(--muted)]">
                      Нет чатов, куда можно отправить.
                    </p>
                  )}
                  {sendable.map((c) => (
                    <label
                      key={c.id}
                      className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--line)] px-3 py-2.5 text-[15px]"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--accent)]"
                      />
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {c.title}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="flex flex-wrap gap-2 md:col-span-2">
                  <button type="submit" className={cn(s.btn, "max-md:w-full")}>
                    <Send className="size-4" aria-hidden />
                    Отправить сообщение
                  </button>
                </div>
              </fieldset>
            </form>
          </Section>

          <Section
            id="logs"
            title="Журнал"
            count={logs.length}
            lead="Последние отправки по вашим чатам, не больше 30."
          >
            {logs.length === 0 ? (
              <Empty>Отправок пока нет.</Empty>
            ) : (
              <ol className={cn(s.card, "divide-y divide-[var(--line)]")}>
                {logs.map((l) => {
                  const [label, tone] = STATUS[l.status]
                  return (
                    <li
                      key={l.id}
                      className="grid min-w-0 gap-1 px-4 py-3 md:grid-cols-[130px_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-4"
                    >
                      <span className="font-mono text-xs text-[var(--muted)] md:text-sm">
                        {fmt.format(l.slot)}
                      </span>
                      <span className="min-w-0 font-bold [overflow-wrap:anywhere]">
                        {l.chat.title}
                      </span>
                      <span className="min-w-0 text-[15px] [overflow-wrap:anywhere] text-[var(--muted)]">
                        {l.template?.name ??
                          (l.outbox?.text != null
                            ? l.options.length
                              ? "Свой опрос"
                              : "Ручной текст"
                            : "— удалён —")}
                        {l.error && (
                          <span className="block text-sm break-all text-[var(--danger)]">
                            {l.error}
                          </span>
                        )}
                      </span>
                      <span>
                        <Pill tone={tone}>{label}</Pill>
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
          </Section>
        </main>
      </div>
    </div>
  )
}
