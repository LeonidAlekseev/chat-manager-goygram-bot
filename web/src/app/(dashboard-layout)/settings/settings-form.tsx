"use client"

import { useActionState } from "react"
import { Save } from "lucide-react"

import type { settingsView } from "@/lib/settings"
import type { ActionState } from "./actions"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { saveSettings } from "./actions"

const NOT_SET = "не задан"

export function SettingsForm({
  current,
}: {
  current: Awaited<ReturnType<typeof settingsView>>
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveSettings,
    null
  )
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <p className="text-sm">
        Бот:{" "}
        {current.botUsername
          ? `@${current.botUsername}`
          : "ещё не запускался с этим токеном"}
      </p>
      <p className="text-sm text-muted-foreground">
        Пустое поле оставляет текущее значение. После сохранения бот
        перезапустится с новыми данными.
      </p>
      <div className="grid gap-2">
        <Label htmlFor="botToken">Токен бота (@BotFather)</Label>
        <Input
          id="botToken"
          name="botToken"
          type="password"
          autoComplete="off"
          placeholder={current.botToken ?? NOT_SET}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="apiId">API ID (my.telegram.org)</Label>
        <Input
          id="apiId"
          name="apiId"
          inputMode="numeric"
          placeholder={current.apiId?.toString() ?? NOT_SET}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="apiHash">API HASH (my.telegram.org)</Label>
        <Input
          id="apiHash"
          name="apiHash"
          type="password"
          autoComplete="off"
          placeholder={current.apiHash ?? NOT_SET}
        />
      </div>
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          <Save />
          Сохранить
        </Button>
        {state?.saved && (
          <p className="text-sm text-muted-foreground">Сохранено.</p>
        )}
        {state?.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
      </div>
    </form>
  )
}
