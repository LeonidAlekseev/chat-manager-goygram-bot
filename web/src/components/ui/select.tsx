import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-11 min-w-0 max-w-full appearance-none rounded-xl border border-input bg-card pr-9 pl-3 bg-[position:right_0.75rem_center] bg-[length:1rem] bg-no-repeat text-base focus-visible:outline-hidden focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
        className
      )}
      {...props}
    />
  )
}
