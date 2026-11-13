const MAX_FAILS = 5
const WINDOW_MS = 15 * 60_000

// shortcut: in-memory, per process — fine for the single panel container; use a DB/Redis table if it ever scales out.
const fails = new Map<string, number[]>()

function recent(key: string, now: number) {
  const list = (fails.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length) fails.set(key, list)
  else fails.delete(key)
  return list
}

export function isLoginBlocked(key: string, now = Date.now()) {
  return recent(key, now).length >= MAX_FAILS
}

export function recordLoginFailure(key: string, now = Date.now()) {
  if (fails.size > 10_000) for (const k of [...fails.keys()]) recent(k, now) // drop expired keys so junk logins cannot grow the map forever
  fails.set(key, [...recent(key, now), now])
}

export function resetLoginFailures(key: string) {
  fails.delete(key)
}

/** Key for the limiter: the same login from the same proxy-reported IP. */
export function loginKey(login: unknown, headers: Headers) {
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  return `${String(login ?? "")}|${ip}`
}
