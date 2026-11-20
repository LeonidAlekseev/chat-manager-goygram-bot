import {
  ChartBar,
  Copy,
  FileText,
  Images,
  Lock,
  MessageSquareText,
  Plus,
  Trophy,
} from "lucide-react"

import type { Viewer } from "@/lib/access"
import type { Template } from "@prisma/client"

import { canEdit, visibleTemplates } from "@/lib/access"
import { db } from "@/lib/db"

import { Empty, Field, MOCK, Panel, Pill, control } from "@/components/v2/ui"

function kindOf(t: Template) {
  if (t.kind === "poll")
    return t.correctOptionId === null
      ? { label: "Опрос", icon: ChartBar }
      : { label: "Викторина", icon: Trophy }
  if (t.mediaType === "album")
    return { label: `Альбом, ${t.sourceMessageIds.length} шт.`, icon: Images }
  if (t.kind === "copy") return { label: `Копия · ${t.mediaType}`, icon: Copy }
  return { label: "Текст", icon: MessageSquareText }
}

export async function TemplatesTab({ v }: { v: Viewer }) {
  const templates = await db.template.findMany({
    where: visibleTemplates(v),
    orderBy: { id: "asc" },
    include: { author: { select: { name: true, login: true } } },
  })

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title={`Шаблоны · ${templates.length}`} icon={FileText}>
        {templates.length === 0 ? (
          <Empty>Шаблонов пока нет.</Empty>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {templates.map((t) => {
              const { label, icon } = kindOf(t)
              return (
                <li
                  key={t.id}
                  className="flex min-w-0 flex-col gap-2 rounded-xl border border-(--v2-line) p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="primary" icon={icon}>
                      {label}
                    </Pill>
                    {!canEdit(v, t) && (
                      <Pill icon={Lock} title="Только суперадмин меняет">
                        Суперадмина
                      </Pill>
                    )}
                  </div>
                  <h3 className="font-bold break-words">{t.name}</h3>
                  <p className="line-clamp-3 text-sm break-words whitespace-pre-line text-(--v2-muted)">
                    {t.text}
                  </p>
                  {t.kind === "poll" && t.options.length > 0 && (
                    <ul className="grid gap-1 text-sm">
                      {t.options.map((o, i) => (
                        <li
                          key={i}
                          className="flex min-w-0 items-center gap-2 rounded-lg bg-(--v2-bg) px-2 py-1"
                        >
                          <span className="size-3 shrink-0 rounded-full border-2 border-(--v2-primary)" />
                          <span className="min-w-0 break-words">{o}</span>
                          {i === t.correctOptionId && (
                            <Pill tone="primary">верный</Pill>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {t.author && (
                    <p className="mt-auto pt-1 text-xs text-(--v2-muted)">
                      Автор: {t.author.name || t.author.login}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Новый шаблон" icon={Plus} className="xl:sticky xl:top-8">
        <fieldset disabled className="grid gap-4">
          <Field label="Название">
            <input className={control} placeholder="Утреннее приветствие" />
          </Field>
          <div className="grid gap-1.5 text-sm">
            <span className="font-bold text-(--v2-muted)">Тип</span>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-(--v2-bg) p-1">
              <span className="grid h-9 place-items-center rounded-lg bg-(--v2-surface) font-bold text-(--v2-primary) shadow-sm">
                Текст
              </span>
              <span className="grid h-9 place-items-center rounded-lg font-bold text-(--v2-muted)">
                Опрос
              </span>
            </div>
          </div>
          <Field label="Текст сообщения">
            <textarea
              rows={5}
              className={`${control} h-auto py-2`}
              placeholder="До 4096 символов"
            />
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 accent-(--v2-primary)" />
            Отметить всех участников
          </label>
          <button
            type="button"
            title={MOCK}
            className="h-11 cursor-not-allowed rounded-xl bg-(--v2-primary) px-4 font-bold text-white"
          >
            Сохранить шаблон
          </button>
        </fieldset>
      </Panel>
    </div>
  )
}
