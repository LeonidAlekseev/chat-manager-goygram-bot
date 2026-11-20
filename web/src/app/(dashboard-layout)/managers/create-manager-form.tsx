"use client"

import { useActionState } from "react"
import { Plus } from "lucide-react"

import type { ActionState } from "./actions"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createManager } from "./actions"

export function CreateManagerForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createManager,
    null
  )
  return (
    <form action={action} className="flex flex-wrap gap-2">
      <Input name="login" placeholder="Логин" required maxLength={64} />
      <Input name="name" placeholder="Имя" required maxLength={255} />
      <Input
        name="password"
        type="password"
        placeholder="Пароль (от 8 символов)"
        required
        minLength={8}
        maxLength={72}
        autoComplete="new-password"
      />
      <Button type="submit" disabled={pending}>
        <Plus />
        Создать
      </Button>
      {state?.error && (
        <p className="w-full text-sm text-destructive">{state.error}</p>
      )}
    </form>
  )
}
