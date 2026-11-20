"use client"

import { useActionState, useState } from "react"
import { Plus, Save } from "lucide-react"

import type { ActionState } from "./actions"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { DeleteForm } from "@/components/delete-form"
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

export function TemplateForm({
  t = empty,
  readOnly = false, // the superadmin's template seen by a manager
}: {
  t?: TemplateView
  readOnly?: boolean
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveTemplate,
    null
  )
  const [kind, setKind] = useState(t.kind)
  const copy = t.kind === "copy"
  const poll = kind === "poll"
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
          <Select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="poll">Опрос</option>
            <option value="text">Текст</option>
          </Select>
          <textarea
            name="text"
            defaultValue={t.text}
            placeholder={
              poll ? "Вопрос опроса (до 300)" : "Текст сообщения (до 4096)"
            }
            required
            maxLength={4096}
            className="min-h-20 rounded-md border bg-background p-2 text-sm"
          />
          {poll && (
            <textarea
              name="options"
              defaultValue={t.options.join("\n")}
              placeholder={
                "Варианты опроса — по одному в строке (2–10, до 100 символов)"
              }
              className="min-h-20 rounded-md border bg-background p-2 text-sm"
            />
          )}
          <div className="flex flex-wrap gap-4">
            {poll && (
              <>
                <Check name="anonymous" label="Анонимный" on={t.anonymous} />
                <Check
                  name="multiple"
                  label="Несколько ответов"
                  on={t.multiple}
                />
              </>
            )}
            <Check name="mentionAll" label="Отметить всех" on={t.mentionAll} />
          </div>
        </>
      )}
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      {readOnly ? (
        <p className="text-sm text-muted-foreground">
          Шаблон суперадмина — только просмотр.
        </p>
      ) : (
        <Button type="submit" disabled={pending} className="w-fit">
          {t.id ? <Save /> : <Plus />}
          {t.id ? "Сохранить" : "Создать"}
        </Button>
      )}
    </form>
  )
}

export function DeleteTemplate({ id, name }: { id: number; name: string }) {
  return (
    <DeleteForm
      action={(fd) => deleteTemplate(null, fd)}
      id={id}
      label={`Удалить шаблон «${name}»`}
      confirmText={`Удалить шаблон «${name}»?`}
      className="absolute right-2 top-2"
    />
  )
}
