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
  const [, start] = useTransition()
  return (
    <form
      {...props}
      onSubmit={(e) => {
        e.preventDefault()
        if (confirmText && !confirm(confirmText)) return
        const fd = new FormData(e.currentTarget)
        start(async () => setResult(await action(fd)))
      }}
    >
      {children}
      {result?.error && (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      )}
    </form>
  )
}
