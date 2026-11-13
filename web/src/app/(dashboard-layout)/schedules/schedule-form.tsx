"use client"

import { useActionState, useRef, useState } from "react"

import type { ActionState } from "./actions"
import type { ItemView } from "./item-view"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { saveSchedule } from "./actions"

const PERIODS = [
  ["none", "Один раз"],
  ["day", "Каждый день"],
  ["week", "Каждую неделю"],
  ["twoweek", "Раз в две недели"],
  ["month", "Каждый месяц"],
] as const

const selectCls = "h-9 rounded-md border bg-background px-2 text-sm"

export function ScheduleForm({
  schedule,
  templates,
  chatId,
  sharedWith = 0,
}: {
  schedule?: { id: number; name: string; items: ItemView[] }
  templates: { id: number; name: string }[]
  chatId?: number
  sharedWith?: number // other chats bound to this schedule
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const scopeRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (prev, fd) => {
      const r = await saveSchedule(prev, fd)
      setOpen(false)
      return r
    },
    null
  )
  const [rows, setRows] = useState(() =>
    (schedule?.items ?? []).map((item, key) => ({ ...item, key }))
  )
  const [nextKey, setNextKey] = useState(rows.length)

  function addRow() {
    setRows([
      ...rows,
      {
        key: nextKey,
        templateId: templates[0]?.id ?? 0,
        time: "08:00",
        startDate: new Date().toLocaleDateString("sv"), // YYYY-MM-DD in local time
        period: "day",
      },
    ])
    setNextKey(nextKey + 1)
  }

  return (
    <form ref={formRef} action={action} className="grid gap-2">
      {schedule && <input type="hidden" name="id" value={schedule.id} />}
      {chatId && <input type="hidden" name="chatId" value={chatId} />}
      <input ref={scopeRef} type="hidden" name="scope" />
      <Input
        name="name"
        defaultValue={schedule?.name}
        placeholder="Название"
        required
        maxLength={255}
      />
      {rows.map((r) => (
        <div key={r.key} className="flex flex-wrap items-center gap-2">
          <select
            name="templateId"
            defaultValue={r.templateId}
            aria-label="Шаблон"
            className={selectCls}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Input
            type="time"
            name="time"
            defaultValue={r.time}
            aria-label="Время"
            required
            className="w-28"
          />
          <Input
            type="date"
            name="startDate"
            defaultValue={r.startDate}
            aria-label="Дата старта"
            required
            className="w-40"
          />
          <select
            name="period"
            defaultValue={r.period}
            aria-label="Период"
            className={selectCls}
          >
            {PERIODS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
          >
            Убрать
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={addRow}
          disabled={templates.length === 0}
        >
          Добавить пункт
        </Button>
        {chatId && sharedWith > 0 ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button type="button" disabled={pending}>
                Сохранить
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Где применить изменения?</DialogTitle>
                <DialogDescription>
                  Это расписание привязано ещё к {sharedWith} чат(ам). «Только в
                  этом чате» создаст для него отдельную копию.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                {(
                  [
                    ["this", "Только в этом чате"],
                    ["all", "Во всех чатах"],
                  ] as const
                ).map(([scope, label]) => (
                  <Button
                    key={scope}
                    type="button"
                    variant={scope === "this" ? "outline" : "default"}
                    disabled={pending}
                    onClick={() => {
                      // the dialog is portaled outside the form, so set scope and submit it directly
                      scopeRef.current!.value = scope
                      formRef.current!.requestSubmit()
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          <Button type="submit" disabled={pending}>
            {schedule ? "Сохранить" : "Создать"}
          </Button>
        )}
      </div>
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
    </form>
  )
}
