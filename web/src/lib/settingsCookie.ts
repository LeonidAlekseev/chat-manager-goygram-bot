import { z } from "zod"

import type { LocaleType, SettingsType } from "@/types"

export const defaultSettings: SettingsType = {
  theme: "zinc",
  radius: 0.5,
  layout: "vertical",
  locale: "en",
}

const storedSettings = z.object({
  theme: z.string(),
  radius: z.number(),
  layout: z.enum(["vertical", "horizontal"]),
  locale: z.literal("en"),
})

// A broken, foreign or old-format ("mode") cookie falls back to defaults instead of throwing.
export function parseSettings(
  raw: string | null | undefined,
  locale: LocaleType
): SettingsType {
  try {
    const parsed = storedSettings.safeParse(JSON.parse(raw ?? ""))
    if (parsed.success) return parsed.data
  } catch {
    // not JSON: use defaults below
  }
  return { ...defaultSettings, locale }
}
