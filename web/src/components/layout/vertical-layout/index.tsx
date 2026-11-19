import type { ReactNode } from "react"

import { Sidebar } from "../sidebar"
import { VerticalLayoutHeader } from "./vertical-layout-header"

export function VerticalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Sidebar />
      <div className="w-full min-w-0">
        <VerticalLayoutHeader />
        <main className="min-h-svh bg-background pt-16">{children}</main>
      </div>
    </>
  )
}
