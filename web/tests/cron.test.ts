import { describe, expect, it } from "vitest"

import { cronMatches, describeCron, nextRuns, parseCron } from "@/lib/cron"

import vectors from "./cron-vectors.json"

// The same vectors are checked by bot/tests/test_scheduler.py: panel and bot read cron alike.
const wall = (s: string) => new Date(`${s}:00Z`) // a wall-clock minute in the zone, kept as UTC fields

describe("cron", () => {
  it.each(vectors.invalid)("refuses %j", (expr) => {
    expect(parseCron(expr)).toBeNull()
  })

  it.each(vectors.matches as [string, string, boolean][])(
    "%j at %s → %s",
    (expr, now, due) => {
      expect(cronMatches(expr, wall(now))).toBe(due)
    }
  )

  it("lists the next runs after now, across the day and month end", () => {
    const iso = (d: Date[]) => d.map((x) => x.toISOString().slice(0, 16))
    expect(iso(nextRuns("*/15 * * * *", wall("2026-03-31T23:40")))).toEqual([
      "2026-03-31T23:45",
      "2026-04-01T00:00",
      "2026-04-01T00:15",
    ])
    expect(iso(nextRuns("0 9 1 * *", wall("2026-12-01T09:00")))).toEqual([
      "2027-01-01T09:00",
      "2027-02-01T09:00",
      "2027-03-01T09:00",
    ])
    expect(nextRuns("0 0 31 2 *", wall("2026-01-01T00:00"))).toEqual([])
    expect(nextRuns("bad", wall("2026-01-01T00:00"))).toEqual([])
  })

  it.each([
    ["* * * * *", "каждую минуту"],
    ["*/5 * * * *", "каждые 5 мин"],
    ["0 * * * *", "каждый час в :00"],
    ["30 */3 * * *", "каждые 3 ч в :30"],
    ["5 9 * * *", "каждый день в 09:05"],
    ["0 9 * * 1-5", "минута 0, час 9, день недели 1-5"],
  ])("describes %j", (expr, text) => {
    expect(describeCron(expr)).toBe(text)
  })
})
