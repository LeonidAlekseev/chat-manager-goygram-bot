import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export type Tone = "ok" | "bad" | "wait" | "plain"

const tones: Record<Tone, string> = {
  ok: "bg-[var(--accent-soft)] text-[var(--accent)]",
  bad: "bg-[var(--danger-soft)] text-[var(--danger)]",
  wait: "bg-[var(--warn-soft)] text-[var(--warn)]",
  plain: "bg-[var(--surface)] text-[var(--muted)]",
}

export function Pill({
  tone = "plain",
  children,
}: {
  tone?: Tone
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap",
        tones[tone]
      )}
    >
      {children}
    </span>
  )
}

export function Section({
  id,
  title,
  count,
  lead,
  children,
}: {
  id: string
  title: string
  count?: number
  lead: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className="scroll-mt-20 border-t border-[var(--line)] py-10 first:border-t-0 first:pt-0 md:scroll-mt-8"
    >
      <div className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          id={`${id}-h`}
          className="text-2xl font-bold tracking-tight md:text-[28px]"
        >
          {title}
        </h2>
        {count !== undefined && (
          <span className="font-mono text-sm text-[var(--muted)]">{count}</span>
        )}
        <p className="w-full max-w-2xl text-[15px] text-[var(--muted)]">
          {lead}
        </p>
      </div>
      {children}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[var(--radius)] border border-dashed border-[var(--line)] p-6 text-[var(--muted)]">
      {children}
    </p>
  )
}

export function FieldLabel({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn("grid min-w-0 gap-1.5", className)}>
      <span className="text-xs font-bold tracking-wide text-[var(--muted)] uppercase">
        {label}
      </span>
      {children}
    </label>
  )
}
