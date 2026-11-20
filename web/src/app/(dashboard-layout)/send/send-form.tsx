"use client"

import { useActionState, useState } from "react"
import { Send } from "lucide-react"

import type { ActionState } from "./actions"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { ChatAvatar } from "@/components/chat-avatar"
import { sendNow } from "./actions"

const field = "min-h-20 w-full rounded-md border bg-background p-2 text-sm"

function Radios<T extends string>({
  legend,
  value,
  onChange,
  choices,
}: {
  legend: string
  value: T
  onChange: (v: T) => void
  choices: readonly (readonly [T, string])[]
}) {
  return (
    <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      <legend className="sr-only">{legend}</legend>
      {choices.map(([v, label]) => (
        <label key={v} className="flex items-center gap-2">
          <input
            type="radio"
            checked={value === v}
            onChange={() => onChange(v)}
          />
          {label}
        </label>
      ))}
    </fieldset>
  )
}

function Check({ name, label }: { name: string; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} /> {label}
    </label>
  )
}

export function SendForm({
  templates,
  chats,
  timezone,
}: {
  templates: { id: number; name: string }[]
  chats: { id: number; title: string; photo: { uniqueId: string } | null }[]
  timezone: string
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    sendNow,
    null
  )
  const [mode, setMode] = useState<"template" | "text" | "poll">("poll")
  const [when, setWhen] = useState<"now" | "later">("now")
  return (
    <form action={action} className="grid gap-3">
      <Radios
        legend="Что отправить"
        value={mode}
        onChange={setMode}
        choices={[
          ["template", "Шаблон"],
          ["text", "Свой текст"],
          ["poll", "Свой опрос"],
        ]}
      />
      {/* only the chosen fields are rendered, so only they are submitted */}
      {mode === "template" && (
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
      )}
      {mode === "text" && (
        <>
          <textarea
            name="text"
            aria-label="Текст"
            placeholder="Текст сообщения (до 4096)"
            required
            maxLength={4096}
            className={field}
          />
          <Check name="mentionAll" label="Отметить всех" />
        </>
      )}
      {mode === "poll" && (
        <>
          <textarea
            name="question"
            aria-label="Вопрос"
            placeholder="Вопрос опроса (до 300)"
            required
            maxLength={300}
            className={field}
          />
          <textarea
            name="options"
            aria-label="Варианты"
            placeholder="Варианты — по одному в строке (2–10, до 100 символов)"
            required
            className={field}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Check name="anonymous" label="Анонимный" />
            <Check name="multiple" label="Несколько ответов" />
            <Check name="mentionAll" label="Отметить всех" />
          </div>
        </>
      )}
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm text-muted-foreground">Чаты</legend>
        {chats.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="chatIds" value={c.id} />
            <ChatAvatar chat={c} className="size-6" />
            {c.title}
          </label>
        ))}
      </fieldset>
      <Radios
        legend="Когда отправить"
        value={when}
        onChange={setWhen}
        choices={[
          ["now", "Сейчас"],
          ["later", "Запланировать"],
        ]}
      />
      {when === "later" && (
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">
            Дата и время ({timezone})
          </span>
          <Input
            type="datetime-local"
            name="sendAt"
            required
            className="w-full max-w-60"
          />
        </label>
      )}
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      {state && !state.error && (
        <p className="text-sm text-muted-foreground">
          {when === "later" ? "Запланировано." : "Поставлено в очередь."}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-fit">
        <Send />
        {when === "later" ? "Запланировать" : "Отправить"}
      </Button>
    </form>
  )
}
