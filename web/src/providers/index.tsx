import type { LocaleType } from "@/types"
import type { ReactNode } from "react"

import { SettingsProvider } from "@/contexts/settings-context"
import { SidebarProvider } from "@/components/ui/sidebar"
import { ThemeProvider } from "./theme-provider"

export function Providers({
  locale,
  children,
}: Readonly<{
  locale: LocaleType
  children: ReactNode
}>) {
  return (
    <SettingsProvider locale={locale}>
      <ThemeProvider>
        <SidebarProvider>{children}</SidebarProvider>
      </ThemeProvider>
    </SettingsProvider>
  )
}
