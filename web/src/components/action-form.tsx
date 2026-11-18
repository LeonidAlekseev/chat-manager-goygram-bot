"use client"

import { useState, useTransition } from "react"

import type { ComponentProps } from "react"

type Result = { error?: string } | void

// Submits through a transition instead of the form's `action`, because React resets the form after an
// action and a failed save would wipe what was typed. Without JS the form does nothing (the panel needs JS).
export function ActionForm({
  action,
  children,
  confirmText,
  ...props
}: Omit<ComponentProps<"form">, "action"> & {
  action: (formData: FormData) => Promise<Result>
  confirmText?: string // asked before submitting
}) {
  const [result, setResult] = useState<Result>()
  const [pending, start] = useTransition()
  return (
    <form
      {...props}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault()
        if (confirmText && !confirm(confirmText)) return
        const fd = new FormData(e.currentTarget)
        start(async () => {
          try {
            setResult(await action(fd))
          } catch {
            // a dropped connection (mobile network) rejects the action; without this the form just sits silent
            setResult({ error: "Нет связи с сервером, попробуйте ещё раз" })
          }
        })
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {result?.error && (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      )}
    </form>
  )
}
