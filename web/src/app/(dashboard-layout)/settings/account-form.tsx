"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"

import type { accountView } from "@/lib/settings"
import type { ActionState } from "./actions"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { loginStep, logout, restart } from "./actions"

const STEPS = {
  phone: { label: "Телефон аккаунта", button: "Получить код", type: "tel" },
  code: { label: "Код из Telegram", button: "Войти", type: "text" },
  password: {
    label: "Пароль двухэтапной проверки",
    button: "Войти",
    type: "password",
  },
} as const

export function AccountForm({
  view,
}: {
  view: Awaited<ReturnType<typeof accountView>>
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState<ActionState, FormData>(
    loginStep,
    null
  )
  const { login } = view
  // The bot answers within a few seconds; poll until it has taken the step.
  useEffect(() => {
    if (!login.pending) return
    const t = setInterval(() => router.refresh(), 2000)
    return () => clearInterval(t)
  }, [login.pending, router])

  const waiting = login.stuck ? (
    <p className="text-sm text-destructive">Бот не ответил.</p>
  ) : (
    login.pending && (
      <p className="text-sm text-muted-foreground">Бот выполняет шаг…</p>
    )
  )
  const startOver = (
    <form action={restart}>
      <Button type="submit" variant="link" className="px-0">
        Начать заново
      </Button>
    </form>
  )

  if (view.account)
    return (
      <div className="grid gap-2">
        <form action={logout} className="flex items-center gap-4">
          <p className="text-sm">Вход выполнен: {view.account}</p>
          <Button type="submit" variant="outline" disabled={login.pending}>
            Выйти
          </Button>
          {waiting}
        </form>
        {login.stuck && startOver}
      </div>
    )

  const step = (login.state ?? "phone") as keyof typeof STEPS
  const s = STEPS[step]
  return (
    <div className="grid max-w-xl gap-4">
      <p className="text-sm text-muted-foreground">
        Аккаунт нужен для /all, «отметить всех» и «не ответили». Сессия хранится
        в базе зашифрованной.
      </p>
      <form action={action} className="grid gap-2">
        <input type="hidden" name="step" value={step} />
        <Label htmlFor="value">{s.label}</Label>
        <Input
          key={step}
          id="value"
          name="value"
          type={s.type}
          autoComplete="off"
          placeholder={step === "phone" ? "+79990001122" : undefined}
        />
        <div className="flex items-center gap-4">
          <Button type="submit" disabled={pending || login.pending}>
            {s.button}
          </Button>
          {waiting}
          {(state?.error ?? login.error) && (
            <p className="text-sm text-destructive">
              {state?.error ?? login.error}
            </p>
          )}
        </div>
      </form>
      {(step !== "phone" || login.pending) && startOver}
    </div>
  )
}
