import type { LocaleType } from "@/types"
import type { ReactNode } from "react"

import { SettingsProvider } from "@/contexts/settings-context"
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
      <ThemeProvider>{children}</ThemeProvider>
    </SettingsProvider>
  )
}
