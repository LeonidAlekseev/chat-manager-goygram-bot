"use client"

import { useActionState } from "react"

import type { ActionState } from "./actions"

import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { sendNow } from "./actions"

export function SendForm({
  templates,
  chats,
}: {
  templates: { id: number; name: string }[]
  chats: { id: number; title: string }[]
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    sendNow,
    null
  )
  return (
    <form action={action} className="grid gap-3">
      <Select name="templateId" defaultValue="" aria-label="Шаблон">
        <option value="">— без шаблона —</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      <textarea
        name="text"
        placeholder="…или произвольный текст (до 4096), если шаблон не выбран"
        maxLength={4096}
        className="min-h-20 rounded-md border bg-background p-2 text-sm"
      />
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm text-muted-foreground">Чаты</legend>
        {chats.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="chatIds" value={c.id} /> {c.title}
          </label>
        ))}
      </fieldset>
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      {state && !state.error && (
        <p className="text-sm text-muted-foreground">Поставлено в очередь.</p>
      )}
      <Button type="submit" disabled={pending} className="w-fit">
        Отправить
      </Button>
    </form>
  )
}
