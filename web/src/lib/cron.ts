// 5-field cron (minute hour day month weekday), the same rules as bot/bot/cron.py.
// Fields take `*`, `n`, `a-b`, lists and `/step`; no names (JAN, MON) or @macros. Weekday 0 and 7 are Sunday.
// As in Vixie cron, when both day fields are restricted (do not start with `*`) either one matching is enough.
// Times are wall-clock minutes in TIMEZONE_NAME, carried in a Date's UTC fields.

const RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const
const ITEM = /^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/

type Cron = { fields: Set<number>[]; either: boolean }

export function parseCron(expr: string): Cron | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const fields = []
  for (const [i, part] of parts.entries()) {
    const [lo, hi] = RANGES[i]
    const values = new Set<number>()
    for (const item of part.split(",")) {
      const m = ITEM.exec(item)
      if (!m) return null
      const a = m[1] ? +m[1] : lo
      const b = m[2] ? +m[2] : !m[1] || m[3] ? hi : a // `5/10` runs 5 to the end
      const step = m[3] ? +m[3] : 1
      if (!(lo <= a && a <= b && b <= hi && step >= 1)) return null
      for (let v = a; v <= b; v += step) values.add(v)
    }
    fields.push(values)
  }
  if (fields[4].has(7)) fields[4].add(0)
  return {
    fields,
    either: !parts[2].startsWith("*") && !parts[4].startsWith("*"),
  }
}

/** The form the panel stores a valid cron in: single spaces. */
export const normalizeCron = (expr: string) =>
  expr.trim().split(/\s+/).join(" ")

function dayMatches({ fields: [, , dom, mon, dow], either }: Cron, t: Date) {
  const days = [dom.has(t.getUTCDate()), dow.has(t.getUTCDay())]
  return (
    mon.has(t.getUTCMonth() + 1) &&
    (either ? days.some(Boolean) : days.every(Boolean))
  )
}

function matches(c: Cron, t: Date) {
  const [mi, h] = c.fields
  return mi.has(t.getUTCMinutes()) && h.has(t.getUTCHours()) && dayMatches(c, t)
}

export function cronMatches(expr: string, at: Date): boolean {
  const c = parseCron(expr)
  return !!c && matches(c, at)
}

const MIN = 60_000

/** The next `n` runs after `now`, looking up to 5 years ahead; none for an invalid cron. */
export function nextRuns(expr: string, now: Date, n = 3): Date[] {
  const c = parseCron(expr)
  const runs: Date[] = []
  if (!c) return runs
  const [mi, h, , mon] = c.fields
  const end = now.getTime() + 5 * 366 * 24 * 60 * MIN
  let t = new Date(Math.floor(now.getTime() / MIN) * MIN + MIN)
  while (runs.length < n && t.getTime() <= end) {
    const [y, m, d, hh] = [
      t.getUTCFullYear(),
      t.getUTCMonth(),
      t.getUTCDate(),
      t.getUTCHours(),
    ]
    // skip a whole month, day or hour that cannot match
    if (!mon.has(m + 1)) t = new Date(Date.UTC(y, m + 1, 1))
    else if (!dayMatches(c, t)) t = new Date(Date.UTC(y, m, d + 1))
    else if (!h.has(hh)) t = new Date(Date.UTC(y, m, d, hh + 1))
    else {
      if (mi.has(t.getUTCMinutes())) runs.push(t)
      t = new Date(t.getTime() + MIN)
    }
  }
  return runs
}

/** A short Russian reading of a valid cron: the common shapes in words, the rest field by field. */
export function describeCron(expr: string): string {
  if (!parseCron(expr)) return ""
  const [mi, h, dom, mon, dow] = normalizeCron(expr).split(" ")
  if (dom === "*" && mon === "*" && dow === "*") {
    const every = (f: string) => /^\*\/(\d+)$/.exec(f)?.[1]
    if (mi === "*" && h === "*") return "каждую минуту"
    if (h === "*" && every(mi)) return `каждые ${every(mi)} мин`
    if (/^\d+$/.test(mi)) {
      const at = `:${mi.padStart(2, "0")}`
      if (h === "*") return `каждый час в ${at}`
      if (every(h)) return `каждые ${every(h)} ч в ${at}`
      if (/^\d+$/.test(h)) return `каждый день в ${h.padStart(2, "0")}${at}`
    }
  }
  return (
    [
      ["минута", mi],
      ["час", h],
      ["день месяца", dom],
      ["месяц", mon],
      ["день недели", dow],
    ] as const
  )
    .filter(([, v]) => v !== "*")
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")
}
