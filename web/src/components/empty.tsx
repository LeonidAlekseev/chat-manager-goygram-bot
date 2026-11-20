import type { ReactNode } from "react"

// the dashed "nothing here yet" box of the /v2 design (#112)
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  )
}
