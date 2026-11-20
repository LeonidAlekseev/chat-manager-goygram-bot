import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority"

import type { VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

export const badgeVariants = cva(
  "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary-soft text-primary",
        secondary: "border-border bg-background text-muted-foreground",
        destructive: "border-transparent bg-destructive-soft text-destructive",
        action: "border-transparent bg-action-soft text-action",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type BadgeProps = ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
  }

export function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: BadgeProps) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}
