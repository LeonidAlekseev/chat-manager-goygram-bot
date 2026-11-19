"use client"

import { useActionState, useState } from "react"

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
  const [mode, setMode] = useState<"template" | "text">("template")
  return (
    <form action={action} className="grid gap-3">
      <fieldset className="flex gap-4 text-sm">
        <legend className="sr-only">Что отправить</legend>
        {(
          [
            ["template", "Шаблон"],
            ["text", "Свой текст"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              checked={mode === value}
              onChange={() => setMode(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {/* only the chosen field is rendered, so only it is submitted */}
      {mode === "template" ? (
        <Select name="templateId" defaultValue="" aria-label="Шаблон" required>
          <option value="" disabled>
            — выберите шаблон —
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      ) : (
        <>
          <textarea
            name="text"
            aria-label="Текст"
            placeholder="Текст сообщения (до 4096)"
            required
            maxLength={4096}
            className="min-h-20 rounded-md border bg-background p-2 text-sm"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="mentionAll" /> Отметить всех
          </label>
        </>
      )}
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
