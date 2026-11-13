"use client"

import { useActionState } from "react"

import type { ActionState } from "./actions"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { deleteTemplate, saveTemplate } from "./actions"

export type TemplateView = {
  id?: number
  name: string
  kind: "poll" | "text" | "copy"
  text: string
  options: string[]
  anonymous: boolean
  multiple: boolean
  mentionAll: boolean
}

const empty: TemplateView = {
  name: "",
  kind: "poll",
  text: "",
  options: [],
  anonymous: false,
  multiple: false,
  mentionAll: false,
}

function Check({
  name,
  label,
  on,
}: {
  name: string
  label: string
  on: boolean
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={on} /> {label}
    </label>
  )
}

export function TemplateForm({ t = empty }: { t?: TemplateView }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveTemplate,
    null
  )
  const copy = t.kind === "copy"
  return (
    <form action={action} className="grid gap-2">
      {t.id && <input type="hidden" name="id" value={t.id} />}
      <Input
        name="name"
        defaultValue={t.name}
        placeholder="Название"
        required
        maxLength={255}
      />
      {copy ? (
        <>
          <p className="rounded-md border bg-muted p-2 text-sm whitespace-pre-wrap">
            {t.text || "Без текста"}
          </p>
          <p className="text-sm text-muted-foreground">
            Содержимое изменить нельзя — перешлите сообщение боту заново.
          </p>
          <Check name="mentionAll" label="Отметить всех" on={t.mentionAll} />
        </>
      ) : (
        <>
          <select
            name="kind"
            defaultValue={t.kind}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="poll">Опрос</option>
            <option value="text">Текст</option>
          </select>
          <textarea
            name="text"
            defaultValue={t.text}
            placeholder="Вопрос опроса (до 300) или текст сообщения (до 4096)"
            required
            maxLength={4096}
            className="min-h-20 rounded-md border bg-background p-2 text-sm"
          />
          <textarea
            name="options"
            defaultValue={t.options.join("\n")}
            placeholder={
              "Варианты опроса — по одному в строке (2–10, до 100 символов)"
            }
            className="min-h-20 rounded-md border bg-background p-2 text-sm"
          />
          <div className="flex flex-wrap gap-4">
            <Check name="anonymous" label="Анонимный" on={t.anonymous} />
            <Check name="multiple" label="Несколько ответов" on={t.multiple} />
            <Check name="mentionAll" label="Отметить всех" on={t.mentionAll} />
          </div>
        </>
      )}
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      <Button type="submit" disabled={pending} className="w-fit">
        {t.id ? "Сохранить" : "Создать"}
      </Button>
    </form>
  )
}

export function DeleteTemplate({ id }: { id: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    deleteTemplate,
    null
  )
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline" disabled={pending}>
        Удалить
      </Button>
      {state?.error && (
        <span className="text-sm text-destructive">{state.error}</span>
      )}
    </form>
  )
}
