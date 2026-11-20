import { Slot } from "@radix-ui/react-slot"

import type { LucideIcon } from "lucide-react"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

interface CardProps extends ComponentProps<"div"> {
  asChild?: boolean
}

export function Card({ className, asChild, ...props }: CardProps) {
  const Comp = asChild ? Slot : "div"

  return (
    <Comp
      data-slot="card"
      className={cn(
        "min-w-0 rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_rgb(15_46_43/0.06)]",
        className
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col space-y-1.5 p-4 sm:p-5", className)}
      {...props}
    />
  )
}

interface CardTitleProps extends ComponentProps<"div"> {
  asChild?: boolean
  icon?: LucideIcon // the teal chip of a /v2 panel header
}

export function CardTitle({
  className,
  asChild,
  icon: Icon,
  children,
  ...props
}: CardTitleProps) {
  const Comp = asChild ? Slot : "h2"

  return (
    <Comp
      data-slot="card-title"
      className={cn(
        "flex min-w-0 items-center gap-2 text-base font-bold leading-tight",
        className
      )}
      {...props}
    >
      {Icon && (
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
      )}
      {children}
    </Comp>
  )
}

export function CardDescription({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("p-4 pt-0 sm:p-5 sm:pt-0", className)}
      {...props}
    />
  )
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("flex items-center p-4 pt-0 sm:p-5 sm:pt-0", className)}
      {...props}
    />
  )
}
