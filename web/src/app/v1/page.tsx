import Link from "next/link"
import { redirect } from "next/navigation"
import {
  CalendarClock,
  CircleAlert,
  Clock,
  ExternalLink,
  FileText,
  History,
  Lock,
  MessageSquare,
  Plus,
  Save,
  Send,
  Settings,
  Trash2,
  Users,
} from "lucide-react"

import s from "./v1.module.css"

import type { SendStatus } from "@prisma/client"
import type { Metadata } from "next"

import {
  canEdit,
  getViewer,
  isSuper,
  visibleChats,
  visibleSchedules,
  visibleSends,
  visibleTemplates,
} from "@/lib/access"
import { chatLink } from "@/lib/chat-link"
import { db } from "@/lib/db"
import { TIMEZONE, nowInZone } from "@/lib/timezone"

import { byTime, toItemView } from "../(dashboard-layout)/schedules/item-view"

export const metadata: Metadata = { title: "Макет v1" }
export const dynamic = "force-dynamic"

const PERIOD: Record<string, string> = {
  none: "один раз",
  day: "каждый день",
  week: "каждую неделю",
  twoweek: "раз в две недели",
  month: "каждый месяц",
  custom: "cron",
}

const STATUS: Record<SendStatus, [string, string, typeof Clock]> = {
  sent: ["Отправлено", s.ok, Send],
  error: ["Ошибка", s.bad, CircleAlert],
  pending: ["В процессе", s.wait, Clock],
}

const day = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
  day: "numeric",
  month: "long",
  timeZone: TIMEZONE,
})
const hm = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIMEZONE,
})
const date = (d: string) => d.split("-").reverse().join(".")

function kind(t: {
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

const NAV = [
  ["chats", "Чаты", MessageSquare],
  ["templates", "Шаблоны", FileText],
  ["schedules", "Расписания", CalendarClock],
  ["send", "Отправка", Send],
  ["journal", "Журнал", History],
] as const

// Read-only showcase: same queries and access rules as the panel pages, no server actions anywhere.
export default async function V1Page({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>
}) {
  const v = await getViewer()
  if (!v) redirect("/login")
  const [chats, templates, schedules, logs, me] = await Promise.all([
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
    db.template.findMany({
      where: visibleTemplates(v),
      orderBy: { name: "asc" },
      include: { author: { select: { name: true, login: true } } },
    }),
    db.schedule.findMany({
      where: visibleSchedules(v),
      orderBy: { name: "asc" },
      include: { items: true },
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
    db.manager.findUnique({
      where: { id: v.id },
      select: { telegramUserId: true, name: true, login: true },
    }),
  ])

  const tplName = (id: number) => templates.find((t) => t.id === id)?.name
  const schedName = (id: number | null) =>
    id &&
    (schedules.find((x) => x.id === id)?.name ?? "Расписание другого менеджера")
  const linked = !!me?.telegramUserId
  const sendChats = chats.filter((c) => c.active && !c.deleting)

  const picked = Number((await searchParams).s)
  const current = schedules.find((x) => x.id === picked) ?? schedules[0]
  const items = (current?.items.map(toItemView) ?? []).sort(byTime)
  const now = nowInZone().slice(11)
  // the «сейчас» line goes before the first timed item still ahead today
  const nowAt = items.some((i) => i.period !== "custom")
    ? (() => {
        const n = items.findIndex((i) => i.period === "custom" || i.time > now)
        return n === -1 ? items.length : n
      })()
    : -1

  const days: [string, typeof logs][] = []
  for (const l of logs) {
    const d = day.format(l.slot)
    if (days.at(-1)?.[0] !== d) days.push([d, []])
    days.at(-1)![1].push(l)
  }
  const counts = {
    chats: chats.length,
    templates: templates.length,
    schedules: schedules.length,
    send: sendChats.length,
    journal: logs.length,
  }

  return (
    <div className={s.root}>
      <aside className={s.rail}>
        <div className={s.brandRow}>
          <span className={s.brand}>
            Task<span>Manager</span>
          </span>
          <span className={s.who}>
            {me?.name || me?.login} · {isSuper(v) ? "суперадмин" : "менеджер"}
          </span>
        </div>
        <nav className={s.nav} aria-label="Разделы">
          {NAV.map(([id, label, Icon]) => (
            <a key={id} href={`#${id}`}>
              <Icon aria-hidden />
              {label}
              <span className={s.count}>{counts[id]}</span>
            </a>
          ))}
        </nav>
        <div className={s.railFoot}>
          Макет v1 · <Link href="/chats">вернуться в панель</Link>
        </div>
      </aside>

      <main className={s.main}>
        <p className={s.notice}>
          <Lock aria-hidden />
          Макет редизайна на ваших данных: только просмотр, формы и кнопки не
          работают.
        </p>

        <section id="chats" className={s.section}>
          <div className={s.head}>
            <h2>Чаты</h2>
            <p>
              {chats.filter((c) => c.active).length} с ботом из {chats.length}
            </p>
          </div>
          {chats.length === 0 ? (
            <p className={s.empty}>
              Добавьте бота в группу — чат появится здесь.
            </p>
          ) : (
            <div className={s.list}>
              {chats.map((c) => {
                const link = chatLink(c.telegramId)
                const mine = c.managers.find((m) => m.managerId === v.id)
                return (
                  <div
                    key={c.id}
                    className={`${s.chat} ${c.active ? "" : s.off}`}
                  >
                    <div className={s.chatTitle}>
                      <span className={s.dot} aria-hidden />
                      {c.title}
                    </div>
                    <div className={s.meta}>
                      {c.deleting ? (
                        <span className={s.pill}>Удаляется…</span>
                      ) : (
                        !c.active && <span className={s.pill}>Бот удалён</span>
                      )}
                      {linked &&
                        ["member", "absent"].includes(
                          mine?.memberStatus ?? ""
                        ) && (
                          <span className={`${s.pill} ${s.wait}`}>
                            Вы не админ
                          </span>
                        )}
                      <span>
                        <CalendarClock aria-hidden />
                        {schedName(c.scheduleId) || "Без расписания"}
                      </span>
                      {isSuper(v) && (
                        <span>
                          <Users aria-hidden />
                          {c.managers
                            .map((m) => m.manager.name || m.manager.login)
                            .join(", ") || "Без менеджеров"}
                        </span>
                      )}
                      {link && (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink aria-hidden />
                          Telegram
                        </a>
                      )}
                      <span className={s.mono}>{c.telegramId.toString()}</span>
                    </div>
                    <div className={s.chatActions}>
                      <button
                        type="button"
                        className={s.iconBtn}
                        disabled
                        aria-label={`Настроить чат «${c.title}»`}
                      >
                        <Settings aria-hidden />
                      </button>
                      {isSuper(v) && (
                        <button
                          type="button"
                          className={s.iconBtn}
                          disabled
                          aria-label={`Удалить чат «${c.title}»`}
                        >
                          <Trash2 aria-hidden />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section id="templates" className={s.section}>
          <div className={s.head}>
            <h2>Шаблоны</h2>
            <p>Что бот отправляет по расписанию или вручную</p>
          </div>
          {templates.length === 0 ? (
            <p className={s.empty}>
              Шаблонов пока нет: перешлите боту сообщение или опрос.
            </p>
          ) : (
            <div className={s.tplGrid}>
              {templates.map((t) => (
                <article key={t.id} className={s.tpl}>
                  <div className={s.tplTop}>
                    <span className={s.pill}>{kind(t)}</span>
                    {t.mentionAll && (
                      <span className={s.pill}>Отметить всех</span>
                    )}
                    {!canEdit(v, t) && (
                      <span className={s.byline}>
                        <Lock aria-hidden />
                        суперадмина
                      </span>
                    )}
                  </div>
                  <span className={s.tplName}>{t.name}</span>
                  {t.text && <p className={s.tplText}>{t.text}</p>}
                  {t.options.length > 0 && (
                    <ul className={s.opts}>
                      {t.options.map((o, i) => (
                        <li
                          key={i}
                          className={i === t.correctOptionId ? s.right : ""}
                        >
                          {o}
                        </li>
                      ))}
                    </ul>
                  )}
                  {t.author && isSuper(v) && (
                    <span className={s.byline}>
                      {t.author.name || t.author.login}
                    </span>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section id="schedules" className={s.section}>
          <div className={s.head}>
            <h2>Расписания</h2>
            <p>Время — {TIMEZONE}</p>
          </div>
          {schedules.length > 1 && (
            <nav className={s.picker} aria-label="Расписание">
              {schedules.map((x) => (
                <Link
                  key={x.id}
                  href={`/v1?s=${x.id}#schedules`}
                  aria-current={x.id === current?.id}
                  scroll={false}
                >
                  {x.name}
                </Link>
              ))}
            </nav>
          )}
          <div className={s.sched}>
            {current ? (
              <div className={s.section}>
                {items.length === 0 ? (
                  <p className={s.empty}>В расписании нет шаблонов.</p>
                ) : (
                  <ol
                    className={s.rundown}
                    aria-label={`Сетка «${current.name}»`}
                  >
                    {items.map((i, n) => (
                      <li key={i.id} style={{ display: "contents" }}>
                        {n === nowAt && (
                          <div className={s.now}>
                            <span>
                              <span className="sr-only">Сейчас </span>
                              {now}
                            </span>
                            <span aria-hidden />
                          </div>
                        )}
                        <div className={s.slot}>
                          <span className={s.time}>
                            {i.period === "custom" ? "cron" : i.time}
                            <small>
                              {i.period === "custom"
                                ? "своя"
                                : PERIOD[i.period]}
                            </small>
                          </span>
                          <span className={s.slotBody}>
                            <b>
                              {tplName(i.templateId) ?? "Шаблон недоступен"}
                            </b>
                            <span>
                              {i.period === "custom" && (
                                <span className={s.mono}>{i.time} · </span>
                              )}
                              {i.period === "none" ? "" : "с "}
                              {date(i.startDate)}
                            </span>
                          </span>
                        </div>
                      </li>
                    ))}
                    {nowAt === items.length && (
                      <li className={s.now}>
                        <span>
                          <span className="sr-only">Сейчас </span>
                          {now}
                        </span>
                        <span aria-hidden />
                      </li>
                    )}
                  </ol>
                )}
                <div className={s.bound}>
                  {chats.filter((c) => c.scheduleId === current.id).length ===
                  0 ? (
                    <span className={s.muted}>
                      Не привязано ни к одному чату
                    </span>
                  ) : (
                    chats
                      .filter((c) => c.scheduleId === current.id)
                      .map((c) => (
                        <span key={c.id} className={s.pill}>
                          <MessageSquare aria-hidden />
                          {c.title}
                        </span>
                      ))
                  )}
                </div>
              </div>
            ) : (
              <p className={s.empty}>
                Расписаний пока нет — соберите первое в форме.
              </p>
            )}

            <fieldset className={s.form} disabled>
              <div className={s.formHead}>
                {current ? "Редактировать" : "Новое расписание"}
                {current && !canEdit(v, current) && (
                  <span className={s.byline}>
                    <Lock aria-hidden />
                    расписание суперадмина — только просмотр
                  </span>
                )}
              </div>
              <label className={s.label}>
                Название
                <input
                  className={s.control}
                  defaultValue={current?.name ?? ""}
                  placeholder="Например, «Утренний опрос»"
                />
              </label>
              {(items.length
                ? items
                : [
                    {
                      id: 0,
                      templateId: templates[0]?.id ?? 0,
                      time: "08:00",
                      startDate: nowInZone().slice(0, 10),
                      period: "day",
                    },
                  ]
              ).map((i, n) => (
                <div key={i.id} className={s.item}>
                  <div className={s.itemHead}>
                    Пункт {n + 1}
                    <button
                      type="button"
                      className={s.iconBtn}
                      aria-label={`Удалить пункт ${n + 1}`}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                  <div className={s.itemGrid}>
                    <label className={s.label}>
                      Шаблон
                      <select className={s.control} defaultValue={i.templateId}>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={s.label}>
                      Время
                      <input
                        className={s.control}
                        defaultValue={i.time}
                        inputMode="numeric"
                      />
                    </label>
                    <label className={s.label}>
                      Старт
                      <input
                        className={s.control}
                        inputMode="numeric"
                        defaultValue={date(i.startDate)}
                      />
                    </label>
                    <label className={s.label}>
                      Повтор
                      <select className={s.control} defaultValue={i.period}>
                        {Object.entries(PERIOD).map(([k, label]) => (
                          <option key={k} value={k}>
                            {k === "custom" ? "своя (cron)" : label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              ))}
              <div className={s.row}>
                <button type="button" className={`${s.btn} ${s.ghost}`}>
                  <Plus aria-hidden />
                  Добавить пункт
                </button>
                <button type="button" className={s.btn}>
                  <Save aria-hidden />
                  Сохранить
                </button>
              </div>
            </fieldset>
          </div>
        </section>

        <section id="send" className={s.section}>
          <div className={s.head}>
            <h2>Отправить сообщение</h2>
            <p>Сейчас или в назначенное время</p>
          </div>
          <fieldset className={s.form} disabled>
            <div className={s.sendGrid}>
              <div className={s.section}>
                <fieldset className={s.seg}>
                  <legend className="sr-only">Что отправить</legend>
                  {["Шаблон", "Свой текст", "Свой опрос"].map((x) => (
                    <label key={x}>
                      <input
                        type="radio"
                        name="v1-mode"
                        defaultChecked={x === "Свой опрос"}
                      />
                      {x}
                    </label>
                  ))}
                </fieldset>
                <label className={s.label}>
                  Вопрос
                  <textarea
                    className={s.control}
                    placeholder="До 300 символов"
                  />
                </label>
                <label className={s.label}>
                  Варианты
                  <textarea
                    className={s.control}
                    placeholder="По одному в строке, от 2 до 10"
                  />
                </label>
                <div className={s.flags}>
                  {["Анонимный", "Несколько ответов", "Отметить всех"].map(
                    (x) => (
                      <label key={x} className={s.check}>
                        <input type="checkbox" />
                        {x}
                      </label>
                    )
                  )}
                </div>
              </div>
              <div className={s.section}>
                <fieldset className={s.checks}>
                  <legend>Чаты</legend>
                  {sendChats.length === 0 && (
                    <p className={s.hint}>Нет чатов с ботом.</p>
                  )}
                  {sendChats.map((c) => (
                    <label key={c.id} className={s.check}>
                      <input type="checkbox" />
                      {c.title}
                    </label>
                  ))}
                </fieldset>
                <fieldset className={s.seg}>
                  <legend className="sr-only">Когда отправить</legend>
                  {["Сейчас", "Запланировать"].map((x) => (
                    <label key={x}>
                      <input
                        type="radio"
                        name="v1-when"
                        defaultChecked={x === "Запланировать"}
                      />
                      {x}
                    </label>
                  ))}
                </fieldset>
                <label className={s.label}>
                  Дата и время ({TIMEZONE})
                  <input className={s.control} type="datetime-local" />
                </label>
                <div className={s.row}>
                  <button type="button" className={s.btn}>
                    <Clock aria-hidden />
                    Запланировать
                  </button>
                </div>
              </div>
            </div>
          </fieldset>
        </section>

        <section id="journal" className={s.section}>
          <div className={s.head}>
            <h2>Журнал</h2>
            <p>Последние {logs.length} отправок</p>
          </div>
          {days.length === 0 ? (
            <p className={s.empty}>
              Отправок пока нет — они появятся, когда бот отправит первый
              шаблон.
            </p>
          ) : (
            days.map(([d, rows]) => (
              <div key={rows[0].id} className={s.day}>
                <h3>{d}</h3>
                {rows.map((l) => {
                  const [label, cls, Icon] = STATUS[l.status]
                  return (
                    <div key={l.id} className={s.log}>
                      <span className={s.t}>{hm.format(l.slot)}</span>
                      <span className={s.what}>
                        {l.template?.name ??
                          (l.outbox?.text != null
                            ? l.options.length
                              ? "Свой опрос"
                              : "Ручной текст"
                            : "— удалён —")}
                        <span>{l.chat.title}</span>
                      </span>
                      <span className={`${s.pill} ${cls}`}>
                        <Icon aria-hidden />
                        {label}
                      </span>
                      {l.error && <span className={s.err}>{l.error}</span>}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  )
}
