"use client"

import { useActionState, useRef, useState } from "react"
import Link from "next/link"

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
import { Select } from "@/components/ui/select"
import { saveSchedule } from "./actions"

const PERIODS = [
  ["none", "Один раз"],
  ["day", "Каждый день"],
  ["week", "Каждую неделю"],
  ["twoweek", "Раз в две недели"],
  ["month", "Каждый месяц"],
] as const

const labelCls = "grid gap-1 text-sm font-medium"

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
  const newRow = (key: number): ItemView & { key: number } => ({
    key,
    templateId: templates[0]?.id ?? 0,
    time: "08:00",
    startDate: new Date().toLocaleDateString("sv"), // YYYY-MM-DD in local time
    period: "day",
  })
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (prev, fd) => {
      const r = await saveSchedule(prev, fd)
      setOpen(false)
      if (!schedule && !r.error) {
        // new-schedule form starts with one empty item again (none without templates)
        setRows(templates.length ? [newRow(nextKey)] : [])
        setNextKey(nextKey + 1)
      }
      return r
    },
    null
  )
  const [rows, setRows] = useState(() =>
    schedule
      ? schedule.items.map((item, key) => ({ ...item, key }))
      : templates.length
        ? [newRow(0)]
        : []
  )
  const [nextKey, setNextKey] = useState(rows.length)

  function addRow() {
    setRows([...rows, newRow(nextKey)])
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
        <div
          key={r.key}
          className="grid gap-2 sm:grid-cols-[1fr_auto_auto_1fr_auto] sm:items-end"
        >
          <input type="hidden" name="itemId" value={r.id ?? ""} />
          <label className={labelCls}>
            Шаблон
            <Select name="templateId" defaultValue={r.templateId}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </label>
          <label className={labelCls}>
            Время
            <Input
              type="time"
              name="time"
              defaultValue={r.time}
              required
              className="sm:w-28"
            />
          </label>
          <label className={labelCls}>
            Дата старта
            <Input
              type="date"
              name="startDate"
              defaultValue={r.startDate}
              required
              className="sm:w-40"
            />
          </label>
          <label className={labelCls}>
            Периодичность
            <Select name="period" defaultValue={r.period}>
              {PERIODS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <Button
            type="button"
            variant="ghost"
            className="justify-self-start"
            onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
          >
            Убрать
          </Button>
        </div>
      ))}
      {templates.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Сначала создайте шаблон: перешлите сообщение или опрос боту или
          создайте его на странице{" "}
          <Link href="/templates" className="underline">
            «Шаблоны»
          </Link>
          .
        </p>
      )}
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
      <p className="text-sm text-muted-foreground">
        Пункт — какой шаблон, во сколько и как часто отправлять.
      </p>
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
    </form>
  )
}
