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
    <form
      action={action}
      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]"
    >
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
        <p className="text-sm text-destructive sm:col-span-full">
          {state.error}
        </p>
      )}
    </form>
  )
}
