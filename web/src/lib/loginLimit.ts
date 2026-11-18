const MAX_FAILS = 5
const WINDOW_MS = 15 * 60_000
const MAX_IP_FAILS = 30
const MAX_KEYS = 10_000
export const MAX_LOGIN_LENGTH = 64

// shortcut: in-memory, per process — fine for the single panel container; use a DB/Redis table if it ever scales out.
const fails = new Map<string, number[]>()

function recent(key: string, now: number) {
  const list = (fails.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length) fails.set(key, list)
  else fails.delete(key)
  return list
}

// Per-IP counter lives apart from the login|IP map so junk logins cannot evict it.
const ipFails = new Map<string, number[]>()

const ipOf = (key: string) => key.slice(key.lastIndexOf("|") + 1)

function recentIp(ip: string, now: number) {
  const list = (ipFails.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length) ipFails.set(ip, list)
  else ipFails.delete(ip)
  return list
}

export function isLoginBlocked(key: string, now = Date.now()) {
  return (
    recent(key, now).length >= MAX_FAILS ||
    recentIp(ipOf(key), now).length >= MAX_IP_FAILS
  )
}

export function recordLoginFailure(key: string, now = Date.now()) {
  const ip = ipOf(key)
  const ipList = [...recentIp(ip, now), now]
  ipFails.delete(ip)
  ipFails.set(ip, ipList)
  for (const k of ipFails.keys()) {
    if (ipFails.size <= MAX_KEYS) break
    ipFails.delete(k)
  }
  const list = [...recent(key, now), now]
  fails.delete(key) // re-insert so the key becomes the newest
  fails.set(key, list)
  // Map keeps insertion order: drop the oldest keys so junk logins cannot grow it forever.
  for (const k of fails.keys()) {
    if (fails.size <= MAX_KEYS) break
    fails.delete(k)
  }
}

export function resetLoginFailures(key: string) {
  fails.delete(key)
}

/** Key for the limiter: the same login from the same proxy-reported IP. */
export function loginKey(login: unknown, headers: Headers) {
  // The last entry is the one our reverse proxy (Caddy) appended; earlier ones are client-controlled.
  const ip =
    headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown"
  return `${String(login ?? "").slice(0, MAX_LOGIN_LENGTH)}|${ip}`
}
