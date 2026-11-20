"use client"

import { useActionState, useRef, useState } from "react"
import Link from "next/link"
import { Copy, Layers, Plus, Save, Trash2 } from "lucide-react"

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
import { CronField } from "./cron-field"
import { PERIODS, byTime } from "./item-view"

const labelCls = "grid gap-1.5 text-sm font-bold text-muted-foreground"

export function ScheduleForm({
  schedule,
  templates,
  timezone,
  chatId,
  sharedWith = 0,
  own = true,
}: {
  schedule?: { id: number; name: string; items: ItemView[] }
  templates: { id: number; name: string }[]
  timezone: string // the zone item times are read in
  chatId?: number
  sharedWith?: number // other chats bound to this schedule
  // false: the superadmin's schedule seen by a manager — read-only, or a copy for the chat on its page
  own?: boolean
}) {
  const readOnly = !own && !chatId // the superadmin's schedule on /schedules: view only
  const formRef = useRef<HTMLFormElement>(null)
  const scopeRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const newRow = (key: number): ItemView & { key: number } => ({
    key,
    templateId: 0, // «Не выбран»: the manager picks it
    time: "08:00",
    startDate: new Date().toLocaleDateString("sv", { timeZone: timezone }), // YYYY-MM-DD
    period: "day",
  })
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (prev, fd) => {
      const r = await saveSchedule(prev, fd)
      setOpen(false)
      // React resets the form after the action; on an error put what was typed back
      if (r.error) {
        const col = (k: string) => fd.getAll(k).map(String)
        const [ids, tpls, times, dates, periods] = [
          "itemId",
          "templateId",
          "time",
          "startDate",
          "period",
        ].map(col)
        setName(String(fd.get("name") ?? ""))
        setRows(
          tpls.map((t, i) => ({
            key: nextKey + i,
            id: Number(ids[i]) || undefined,
            templateId: Number(t),
            time: times[i],
            startDate: dates[i],
            period: periods[i],
          }))
        )
        setNextKey(nextKey + tpls.length)
      }
      if (!schedule && !r.error) {
        // new-schedule form starts with one empty item again (none without templates)
        setName("")
        setRows(templates.length ? [newRow(nextKey)] : [])
        setNextKey(nextKey + 1)
      }
      return r
    },
    null
  )
  const [rows, setRows] = useState(() =>
    schedule
      ? [...schedule.items].sort(byTime).map((item, key) => ({ ...item, key }))
      : templates.length
        ? [newRow(0)]
        : []
  )
  const [name, setName] = useState(schedule?.name ?? "")
  const [nextKey, setNextKey] = useState(rows.length)

  const unpicked = rows.some((r) => !r.templateId) // a row still on «Не выбран»

  const edit = (key: number, patch: Partial<ItemView>) =>
    setRows(rows.map((x) => (x.key === key ? { ...x, ...patch } : x)))

  function addRow() {
    setRows([...rows, newRow(nextKey)])
    setNextKey(nextKey + 1)
  }

  return (
    <form ref={formRef} action={action} className="grid gap-3">
      {schedule && <input type="hidden" name="id" value={schedule.id} />}
      {chatId && <input type="hidden" name="chatId" value={chatId} />}
      <input
        ref={scopeRef}
        type="hidden"
        name="scope"
        defaultValue={own ? undefined : "this"}
      />
      {/* read-only: the fields are disabled too, not only the buttons hidden */}
      <fieldset disabled={readOnly} className="contents">
        <Input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название"
          required
          maxLength={255}
        />
        {rows.map((r, n) => (
          <div
            key={r.key}
            className="grid gap-3 rounded-xl border bg-background p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black text-primary">
                Шаблон {n + 1}
              </span>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                  aria-label={`Удалить пункт ${n + 1}`}
                  onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_1fr] sm:items-end">
              <input type="hidden" name="itemId" value={r.id ?? ""} />
              <label className={labelCls}>
                Шаблон
                <Select
                  name="templateId"
                  value={r.templateId || ""}
                  onChange={(e) =>
                    edit(r.key, { templateId: Number(e.target.value) })
                  }
                  required
                >
                  <option value="">Не выбран</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </label>
              {r.period === "custom" ? (
                <CronField
                  defaultValue={r.time.includes(" ") ? r.time : "0 * * * *"}
                  timezone={timezone}
                  startDate={r.startDate}
                />
              ) : (
                <label className={labelCls}>
                  Время ({timezone})
                  <Input
                    type="time"
                    name="time"
                    defaultValue={r.time.includes(":") ? r.time : "08:00"}
                    required
                    className="sm:w-32"
                  />
                </label>
              )}
              <label className={labelCls}>
                Дата старта
                <Input
                  type="date"
                  name="startDate"
                  defaultValue={r.startDate}
                  onChange={(e) => edit(r.key, { startDate: e.target.value })}
                  required
                  className="sm:w-40"
                />
              </label>
              <label className={labelCls}>
                Периодичность
                <Select
                  name="period"
                  value={r.period}
                  onChange={(e) => edit(r.key, { period: e.target.value })}
                >
                  {PERIODS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          </div>
        ))}
      </fieldset>
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
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            className="border-dashed border-primary"
            onClick={addRow}
            disabled={templates.length === 0 || unpicked}
          >
            <Plus />
            Добавить шаблон
          </Button>
        )}
        {!own && !chatId ? null : own && chatId && sharedWith > 0 ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button type="button" disabled={pending || unpicked}>
                <Save />
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
                    {scope === "this" ? <Copy /> : <Layers />}
                    {label}
                  </Button>
                ))}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          <Button type="submit" disabled={pending || unpicked}>
            {schedule ? <Save /> : <Plus />}
            {schedule ? "Сохранить" : "Создать"}
          </Button>
        )}
      </div>
      {!own && (
        <p className="text-sm text-muted-foreground">
          {chatId
            ? "Расписание суперадмина: сохранение создаст копию только для этого чата."
            : "Расписание суперадмина — только просмотр."}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Шаблон в расписании — что отправить, во сколько и как часто.
      </p>
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
    </form>
  )
}
