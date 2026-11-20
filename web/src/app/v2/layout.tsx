import type { Metadata } from "next"
import type { ReactNode } from "react"

import "./v2.css"

export const metadata: Metadata = { title: "Редизайн v2" }

export default function V2Layout({ children }: { children: ReactNode }) {
  return (
    <div className="v2 min-h-dvh w-full bg-(--v2-bg) text-(--v2-ink)">
      {children}
    </div>
  )
}
