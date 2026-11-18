"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"

import type { accountView } from "@/lib/settings"
import type { ActionState } from "./actions"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { loginStep, logout, restart } from "./actions"
import { QRCodeSVG } from "qrcode.react"

const DISCONNECT_CONFIRM =
  "Сессия Telegram будет завершена, придётся войти заново. Продолжить?"

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
  // The bot answers within a few seconds; poll until it has taken the step,
  // and while a QR code is shown: the bot renews it and logs in once it is scanned.
  const poll = login.pending || login.state === "qr"
  useEffect(() => {
    if (!poll) return
    const t = setInterval(() => router.refresh(), 2000)
    return () => clearInterval(t)
  }, [poll, router])

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
        <form
          action={logout}
          onSubmit={(e) => {
            // window.confirm: the project has no AlertDialog component.
            if (!window.confirm(DISCONNECT_CONFIRM)) e.preventDefault()
          }}
          className="flex items-center gap-4"
        >
          <p className="text-sm">Вход выполнен: {view.account}</p>
          <Button type="submit" variant="outline" disabled={login.pending}>
            Отключить аккаунт Telegram
          </Button>
          {waiting}
        </form>
        {login.stuck && startOver}
        {/* e.g. «Аккаунт Telegram не отвечает» from the bot's liveness check */}
        {login.error && (
          <p className="text-sm text-destructive">{login.error}</p>
        )}
      </div>
    )

  const error = (state?.error ?? login.error) && (
    <p className="text-sm text-destructive">{state?.error ?? login.error}</p>
  )
  const intro = (
    <p className="text-sm text-muted-foreground">
      Аккаунт нужен для /all, «отметить всех» и «не ответили». Сессия хранится в
      базе зашифрованной.
    </p>
  )

  if (login.state === "qr" && login.qr)
    return (
      <div className="grid max-w-xl gap-4">
        {intro}
        <ol className="list-decimal space-y-1 ps-5 text-sm">
          <li>Откройте Telegram на телефоне, где выполнен вход в аккаунт.</li>
          <li>Настройки → Устройства → Подключить устройство.</li>
          <li>Наведите камеру на QR-код ниже.</li>
        </ol>
        {/* White quiet zone: a scanner needs contrast in the dark theme too. */}
        <div className="w-fit rounded-md bg-white p-4">
          <QRCodeSVG
            value={login.qr}
            size={220}
            title="QR-код для входа в Telegram"
          />
        </div>
        {/* Same token as the QR: for a panel opened on the phone itself. */}
        <div className="grid w-fit gap-2">
          <Button asChild variant="outline">
            <a href={login.qr}>Открыть в Telegram</a>
          </Button>
          <p className="text-sm text-muted-foreground">
            Если панель открыта на телефоне с Telegram — нажмите и подтвердите
            вход.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Код обновляется сам. Если включён пароль двухэтапной проверки, после
          сканирования здесь появится поле для него.
        </p>
        <div className="flex items-center gap-4">
          {startOver}
          {waiting}
          {error}
        </div>
      </div>
    )

  const step = (login.state ?? "phone") as keyof typeof STEPS
  const s = STEPS[step]
  return (
    <div className="grid max-w-xl gap-4">
      {intro}
      {step === "phone" && (
        <form action={action} className="grid gap-2">
          <input type="hidden" name="step" value="qr" />
          <input type="hidden" name="value" value="" />
          <div>
            <Button type="submit" disabled={pending || login.pending}>
              Войти по QR-коду
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Надёжный способ: Telegram на телефоне подтвердит вход. Или войдите
            по коду из Telegram:
          </p>
        </form>
      )}
      {step === "code" && login.sent && <p className="text-sm">{login.sent}</p>}
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
          <Button
            type="submit"
            variant={step === "phone" ? "outline" : "default"}
            disabled={pending || login.pending}
          >
            {s.button}
          </Button>
          {waiting}
          {error}
        </div>
      </form>
      <div className="flex items-center gap-4">
        {step === "code" && login.resend && (
          <form action={action}>
            <input type="hidden" name="step" value="resend" />
            <input type="hidden" name="value" value="" />
            <Button
              type="submit"
              variant="outline"
              disabled={pending || login.pending}
            >
              Отправить код другим способом
            </Button>
          </form>
        )}
        {(step !== "phone" || login.pending) && startOver}
      </div>
    </div>
  )
}
