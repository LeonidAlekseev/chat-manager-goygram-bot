"use client"

import { useActionState, useState } from "react"
import { Send } from "lucide-react"

import type { ActionState } from "./actions"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { ChatAvatar } from "@/components/chat-avatar"
import { chip } from "@/components/chip"
import { Empty } from "@/components/empty"
import { sendNow } from "./actions"

const field =
  "min-h-24 w-full rounded-xl border bg-card p-3 text-base focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-hidden"

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
    // a /v2 segmented control; the real radio covers its label, so it stays clickable and focusable
    <fieldset className="grid gap-1.5 text-sm">
      <legend className="mb-1.5 font-bold whitespace-nowrap text-muted-foreground">
        {legend}
      </legend>
      <div
        className="grid gap-1 rounded-xl bg-background p-1"
        style={{
          gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))`,
        }}
      >
        {choices.map(([v, label]) => (
          <label
            key={v}
            className="relative grid min-h-11 place-items-center rounded-lg px-2 text-center font-bold text-muted-foreground has-checked:bg-card has-checked:text-primary has-checked:shadow-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
          >
            <input
              type="radio"
              checked={value === v}
              onChange={() => onChange(v)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Check({ name, label }: { name: string; label: string }) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" name={name} className="size-4" /> {label}
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
    <form action={action} className="grid gap-4">
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
      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-bold whitespace-nowrap text-muted-foreground">
          Чаты · {chats.length}
        </legend>
        {chats.length === 0 && <Empty>Нет активных чатов.</Empty>}
        <div className="flex flex-wrap gap-2">
          {chats.map((c) => (
            <label key={c.id} className={chip}>
              <input type="checkbox" name="chatIds" value={c.id} />
              <ChatAvatar chat={c} className="size-6 rounded-md text-xs" />
              <span className="font-bold">{c.title}</span>
            </label>
          ))}
        </div>
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
          <span className="font-bold text-muted-foreground">
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
      <div className="border-t pt-4">
        <Button
          type="submit"
          variant="action"
          size="lg"
          disabled={pending}
          className="w-fit"
        >
          <Send />
          {when === "later" ? "Запланировать" : "Отправить"}
        </Button>
      </div>
    </form>
  )
}
