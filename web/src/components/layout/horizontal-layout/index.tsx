import type { ReactNode } from "react"

import { Sidebar } from "../sidebar"
import { HorizontalLayoutHeader } from "./horizontal-layout-header"

export function HorizontalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Sidebar />
      <div className="w-full min-w-0">
        <HorizontalLayoutHeader />
        <main className="min-h-[calc(100svh-6.5rem)] bg-background">
          {children}
        </main>
      </div>
    </>
  )
}
