import { CircleAlert, CircleCheck, Filter, History, Loader } from "lucide-react"

import type { Viewer } from "@/lib/access"
import type { SendStatus } from "@prisma/client"

import { visibleChats, visibleSends } from "@/lib/access"
import { db } from "@/lib/db"
import { TIMEZONE } from "@/lib/timezone"

import { Empty, MOCK, Panel, Pill, control } from "@/components/v2/ui"

// icon + word, never color alone
const STATUS = {
  sent: { label: "Отправлено", tone: "primary", icon: CircleCheck },
  error: { label: "Ошибка", tone: "danger", icon: CircleAlert },
  pending: { label: "В процессе", tone: "neutral", icon: Loader },
} as const satisfies Record<SendStatus, unknown>

const fmt = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: TIMEZONE,
})

export async function LogsTab({ v }: { v: Viewer }) {
  const [chats, logs] = await Promise.all([
    db.chat.findMany({
      where: visibleChats(v),
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    db.sendLog.findMany({
      where: visibleSends(v),
      orderBy: { id: "desc" },
      take: 50,
      include: {
        chat: { select: { title: true } },
        template: { select: { name: true } },
        outbox: { select: { text: true } },
      },
    }),
  ])

  return (
    <Panel title="Последние отправки" icon={History}>
      <fieldset
        disabled
        className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto]"
      >
        <select className={control} aria-label="Чат" defaultValue="">
          <option value="">Все чаты</option>
          {chats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <select className={control} aria-label="Статус" defaultValue="">
          <option value="">Все статусы</option>
          {Object.values(STATUS).map((s) => (
            <option key={s.label}>{s.label}</option>
          ))}
        </select>
        <button
          type="button"
          title={MOCK}
          className="inline-flex h-11 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-(--v2-line) px-4 font-bold text-(--v2-primary)"
        >
          <Filter className="size-4" aria-hidden />
          Показать
        </button>
      </fieldset>

      {logs.length === 0 ? (
        <Empty>Отправок пока нет.</Empty>
      ) : (
        // one markup: stacked cards on a phone, table columns from md up
        <div role="table" aria-label="Журнал отправок" className="grid text-sm">
          <div
            role="row"
            className="hidden gap-4 border-b border-(--v2-line) pb-2 text-xs font-bold text-(--v2-muted) md:grid md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1.2fr)_130px]"
          >
            <span role="columnheader">Когда</span>
            <span role="columnheader">Чат</span>
            <span role="columnheader">Что</span>
            <span role="columnheader">Статус</span>
          </div>
          {logs.map((l) => {
            const s = STATUS[l.status]
            return (
              <div
                role="row"
                key={l.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-(--v2-line) py-3 last:border-0 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1.2fr)_130px] md:items-center md:gap-4"
              >
                <span
                  role="cell"
                  className="font-mono text-xs text-(--v2-muted) tabular-nums md:text-sm"
                >
                  {fmt.format(l.slot)}
                </span>
                <span
                  role="cell"
                  className="col-start-1 font-bold break-words md:col-start-auto"
                >
                  {l.chat.title}
                </span>
                <span
                  role="cell"
                  className="col-start-1 min-w-0 break-words text-(--v2-muted) md:col-start-auto md:text-(--v2-ink)"
                  title={l.text ?? undefined}
                >
                  {l.template?.name ??
                    (l.outbox?.text != null
                      ? l.options.length
                        ? "Свой опрос"
                        : "Ручной текст"
                      : "— удалён —")}
                  {l.error && (
                    <span className="mt-0.5 block text-xs break-all text-(--v2-danger)">
                      {l.error}
                    </span>
                  )}
                </span>
                <span
                  role="cell"
                  className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto"
                >
                  <Pill tone={s.tone} icon={s.icon}>
                    {s.label}
                  </Pill>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
