"use client"

import { useActionState } from "react"

import type { ComponentProps } from "react"

type Result = { error?: string } | void

// A plain <form action> can't show a failed action's message; this one prints it under the fields.
export function ActionForm({
  action,
  children,
  ...props
}: Omit<ComponentProps<"form">, "action"> & {
  action: (formData: FormData) => Promise<Result>
}) {
  const [state, run] = useActionState(
    async (_: Result, fd: FormData) => action(fd),
    undefined
  )
  return (
    <form action={run} {...props}>
      {children}
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
    </form>
  )
}
