"use client"

import { createContext, useCallback, useEffect, useState } from "react"
import { useCookie } from "react-use"

import type { LocaleType, SettingsType } from "@/types"
import type { ReactNode } from "react"

import { defaultSettings, parseSettings } from "@/lib/settingsCookie"

export const SettingsContext = createContext<
  | {
      settings: SettingsType
      updateSettings: (newSettings: SettingsType) => void
      resetSettings: () => void
    }
  | undefined
>(undefined)

export function SettingsProvider({
  locale,
  children,
}: {
  locale: LocaleType
  children: ReactNode
}) {
  const [storedSettings, setStoredSettings, deleteStoredSettings] =
    useCookie("settings")
  const [settings, setSettings] = useState<SettingsType | null>(null)

  useEffect(() => {
    const parsed = parseSettings(storedSettings, locale)
    setSettings(parsed)
    // Heal a broken or old cookie so the next load parses cleanly.
    if (storedSettings && JSON.stringify(parsed) !== storedSettings) {
      setStoredSettings(JSON.stringify(parsed))
    }
  }, [storedSettings, locale, setStoredSettings])

  const updateSettings = useCallback(
    (newSettings: SettingsType) => {
      setStoredSettings(JSON.stringify(newSettings))
      setSettings(newSettings)
    },
    [setStoredSettings]
  )

  const resetSettings = useCallback(() => {
    deleteStoredSettings()
    setSettings(defaultSettings)
  }, [deleteStoredSettings])

  // Render children only when settings are ready
  if (!settings) {
    return null
  }

  return (
    <SettingsContext.Provider
      value={{ settings, updateSettings, resetSettings }}
    >
      {children}
    </SettingsContext.Provider>
  )
}
