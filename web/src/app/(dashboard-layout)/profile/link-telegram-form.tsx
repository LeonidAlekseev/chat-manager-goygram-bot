"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { createLinkCode } from "./actions"

export function LinkTelegramForm() {
  const [state, action, pending] = useActionState(createLinkCode, null)
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" disabled={pending}>
        Привязать Telegram
      </Button>
      {state && (
        <p className="text-sm">
          {state.url ? (
            <>
              Откройте ссылку и нажмите «Запустить» (действует 15 минут):{" "}
              <a href={state.url} className="underline">
                {state.url}
              </a>
            </>
          ) : (
            <>
              Отправьте боту в личные сообщения (действует 15 минут):{" "}
              <code className="font-mono">{state.command}</code>
            </>
          )}
        </p>
      )}
    </form>
  )
}
