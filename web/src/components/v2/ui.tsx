import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// Primitives of the /v2 mockup (#107). Colors come from the .v2 scope in app/v2/v2.css.

export const MOCK = "Макет: действие отключено"

export function Panel({
  title,
  icon: Icon,
  aside,
  children,
  className,
}: {
  title: string
  icon?: LucideIcon
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-2xl border border-(--v2-line) bg-(--v2-surface) p-4 shadow-[0_1px_2px_rgb(15_46_43/0.06)] sm:p-5",
        className
      )}
    >
      <header className="mb-4 flex items-center gap-2">
        {Icon && (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--v2-primary-soft) text-(--v2-primary)">
            <Icon className="size-4" aria-hidden />
          </span>
        )}
        <h2 className="min-w-0 flex-1 text-base font-bold">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  )
}

const TONES = {
  neutral: "bg-(--v2-bg) text-(--v2-muted) border-(--v2-line)",
  primary: "bg-(--v2-primary-soft) text-(--v2-primary) border-transparent",
  accent: "bg-(--v2-accent-soft) text-(--v2-accent) border-transparent",
  danger: "bg-(--v2-danger-soft) text-(--v2-danger) border-transparent",
}

export function Pill({
  tone = "neutral",
  icon: Icon,
  title,
  children,
}: {
  tone?: keyof typeof TONES
  icon?: LucideIcon
  title?: string
  children: ReactNode
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold whitespace-nowrap",
        TONES[tone]
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  )
}

export function Field({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn("grid min-w-0 gap-1.5 text-sm", className)}>
      <span className="font-bold text-(--v2-muted)">{label}</span>
      {children}
    </label>
  )
}

// disabled by the surrounding <fieldset disabled>; kept readable — this is a style preview, not a dead form
export const control =
  "h-11 w-full min-w-0 rounded-xl border border-(--v2-line) bg-(--v2-surface) px-3 text-base text-(--v2-ink) disabled:cursor-not-allowed"

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-(--v2-line) p-6 text-center text-sm text-(--v2-muted)">
      {children}
    </p>
  )
}
