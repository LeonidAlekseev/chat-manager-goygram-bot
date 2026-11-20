import { Clock, Send, Timer } from "lucide-react"

import type { Viewer } from "@/lib/access"

import { visibleChats, visibleSends, visibleTemplates } from "@/lib/access"
import { db } from "@/lib/db"
import { TIMEZONE } from "@/lib/timezone"

import { Empty, Field, MOCK, Panel, control } from "@/components/v2/ui"

const fmt = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: TIMEZONE,
})

function Segmented({ legend, items }: { legend: string; items: string[] }) {
  return (
    <fieldset className="grid gap-1.5 text-sm">
      <legend className="mb-1.5 font-bold text-(--v2-muted)">{legend}</legend>
      <div
        className="grid gap-1 rounded-xl bg-(--v2-bg) p-1"
        style={{
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        }}
      >
        {items.map((label, i) => (
          <label
            key={label}
            className="grid min-h-10 place-items-center rounded-lg px-2 text-center font-bold text-(--v2-muted) has-checked:bg-(--v2-surface) has-checked:text-(--v2-primary) has-checked:shadow-sm"
          >
            <input
              type="radio"
              name={legend}
              defaultChecked={i === 0}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export async function SendTab({ v }: { v: Viewer }) {
  const [templates, chats, scheduled] = await Promise.all([
    db.template.findMany({
      where: visibleTemplates(v),
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.chat.findMany({
      where: { active: true, deleting: false, ...visibleChats(v) },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    db.outbox.findMany({
      where: { ...visibleSends(v), sendAt: { gt: new Date() }, sendLog: null },
      orderBy: { sendAt: "asc" },
      take: 20,
      include: {
        chat: { select: { title: true } },
        template: { select: { name: true } },
      },
    }),
  ])

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="Отправить сообщение" icon={Send}>
        <fieldset disabled className="grid gap-5">
          <Segmented legend="Что" items={["Шаблон", "Текст", "Опрос"]} />
          <Field label="Шаблон">
            <select className={control} defaultValue="">
              <option value="" disabled>
                Выберите шаблон
              </option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="grid gap-2 text-sm">
            <legend className="mb-1.5 font-bold text-(--v2-muted)">
              Чаты · {chats.length}
            </legend>
            {chats.length === 0 ? (
              <Empty>Нет активных чатов.</Empty>
            ) : (
              <div className="flex flex-wrap gap-2">
                {chats.map((c, i) => (
                  <label
                    key={c.id}
                    className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-(--v2-line) px-3 has-checked:border-(--v2-primary) has-checked:bg-(--v2-primary-soft) has-checked:text-(--v2-primary)"
                  >
                    <input
                      type="checkbox"
                      defaultChecked={i === 0}
                      className="size-4 shrink-0 accent-(--v2-primary)"
                    />
                    <span className="truncate font-bold">{c.title}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <Segmented legend="Когда" items={["Сейчас", "Запланировать"]} />
          <div className="flex flex-wrap items-center gap-3 border-t border-(--v2-line) pt-4">
            <button
              type="button"
              title={MOCK}
              className="inline-flex h-12 cursor-not-allowed items-center gap-2 rounded-xl bg-(--v2-accent) px-6 font-bold text-white"
            >
              <Send className="size-4" aria-hidden />
              Отправить
            </button>
            <span className="text-xs text-(--v2-muted)">
              Бот отправит в течение минуты
            </span>
          </div>
        </fieldset>
      </Panel>

      <Panel title="Запланировано" icon={Timer}>
        {scheduled.length === 0 ? (
          <Empty>Отложенных отправок нет.</Empty>
        ) : (
          <ul className="grid gap-2">
            {scheduled.map((j) => (
              <li
                key={j.id}
                className="grid min-w-0 gap-0.5 rounded-xl bg-(--v2-bg) p-3 text-sm"
              >
                <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-(--v2-primary) tabular-nums">
                  <Clock className="size-3.5" aria-hidden />
                  {j.sendAt && fmt.format(j.sendAt)}
                </span>
                <span className="font-bold break-words">{j.chat.title}</span>
                <span className="truncate text-(--v2-muted)">
                  {j.options.length > 0 && "Опрос: "}
                  {j.text ?? j.template?.name ?? "— удалён —"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
