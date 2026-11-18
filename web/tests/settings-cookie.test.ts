import { describe, expect, it } from "vitest"

import { defaultSettings, parseSettings } from "@/lib/settingsCookie"

const valid = { theme: "blue", radius: 0.3, layout: "horizontal", locale: "en" }

describe("parseSettings", () => {
  it("reads a valid cookie", () => {
    expect(parseSettings(JSON.stringify(valid), "en")).toEqual(valid)
  })

  it.each([
    ["missing", null],
    ["empty", ""],
    ["broken string", '{"theme":"blue"'],
    ["not JSON", "hello"],
    ["JSON null", "null"],
    ["JSON array", "[1,2]"],
    [
      "wrong field types",
      '{"theme":1,"radius":"x","layout":"vertical","locale":"en"}',
    ],
    [
      "unknown layout",
      '{"theme":"zinc","radius":0.5,"layout":"diagonal","locale":"en"}',
    ],
    ["old format with mode", '{"theme":"zinc","radius":0.5,"mode":"dark"}'],
  ])("falls back to defaults for %s", (_, raw) => {
    expect(parseSettings(raw, "en")).toEqual(defaultSettings)
  })
})
