"use client"

import { useActionState } from "react"
import { Save } from "lucide-react"

import type { ActionState } from "./actions"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateManager } from "./actions"

export function EditManagerForm({
  id,
  login,
  name,
}: {
  id: number
  login: string
  name: string
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    updateManager,
    null
  )
  return (
    <form action={action} className="flex flex-wrap gap-2 sm:flex-nowrap">
      <input type="hidden" name="id" value={id} />
      <Input
        className="min-w-0 flex-1"
        name="name"
        defaultValue={name}
        aria-label={`Имя ${login}`}
        required
        maxLength={255}
      />
      <Input
        className="min-w-0 flex-1"
        name="password"
        type="password"
        placeholder="Новый пароль"
        aria-label={`Новый пароль ${login}`}
        minLength={8}
        maxLength={72}
        autoComplete="new-password"
      />
      <Button
        type="submit"
        variant="outline"
        disabled={pending}
        aria-label="Сохранить"
        className="max-sm:w-9 max-sm:px-0"
      >
        <Save />
        <span className="max-sm:hidden">Сохранить</span>
      </Button>
      {state?.error && (
        <p className="w-full text-sm text-destructive">{state.error}</p>
      )}
    </form>
  )
}
