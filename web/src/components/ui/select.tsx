import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-9 appearance-none rounded-md border border-input bg-background pr-9 pl-3 bg-[position:right_0.75rem_center] bg-[length:1rem] bg-no-repeat text-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        className
      )}
      {...props}
    />
  )
}
