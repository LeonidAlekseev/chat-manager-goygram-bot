import { auth } from "@/auth"

import { decrypt } from "@/lib/crypto"
import { db } from "@/lib/db"

export const TAILS = [200, 500, 1000]
const ERRORS = /error|warn|exception|traceback|fatal|panic/i
const PROJECT_LABEL = "com.docker.compose.project"

/** Docker's log stream: non-TTY containers send frames [stream, 0, 0, 0, size BE u32] + payload; TTY ones send raw text. */
export function demux(buf: Buffer): string {
  const parts: Buffer[] = []
  let i = 0
  while (
    i + 8 <= buf.length &&
    buf[i] <= 2 &&
    !buf[i + 1] &&
    !buf[i + 2] &&
    !buf[i + 3]
  ) {
    const end = i + 8 + buf.readUInt32BE(i + 4)
    parts.push(buf.subarray(i + 8, end))
    i = end
  }
  // decode after joining: a UTF-8 char may be split across frames
  return (i ? Buffer.concat(parts) : buf).toString("utf8")
}

/** Hides secrets before log text leaves the server. */
export function mask(text: string, secrets: (string | undefined)[] = []) {
  for (const s of secrets)
    if (s && s.length >= 8) text = text.replaceAll(s, "***")
  return text
    .replace(/\d{8,10}:[A-Za-z0-9_-]{30,}/g, "***") // bot token
    .replace(/(\w+:\/\/[^\s:/@]*:)[^\s@]+@/g, "$1***@") // URL password
    .replace(
      /([\w-]*(?:secret|passw(?:or)?d|token|api_?hash|api_?key)[\w-]*["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"',}]+)/gi,
      (_, key: string, v: string) =>
        key + (/^["']/.test(v) ? `${v[0]}***${v[0]}` : "***")
    )
    .replace(/\b[0-9a-f]{32}\b/gi, "***") // API hash
    .replace(/\+\d[\d ()-]{8,}\d/g, "***") // phone, formatted
    .replace(/(?<![\w-])\d{11,15}(?!\w)/g, "***") // phone, bare digits; chat ids are -100…
}

// Exact values to hide, whatever form they take in a log line.
async function panelSecrets() {
  const { AUTH_SECRET, SUPERADMIN_PASSWORD, DATABASE_URL } = process.env
  const out = [AUTH_SECRET, SUPERADMIN_PASSWORD]
  try {
    out.push(DATABASE_URL && decodeURIComponent(new URL(DATABASE_URL).password))
  } catch {}
  const s = await db.settings.findUnique({ where: { id: 1 } })
  for (const c of [s?.botToken, s?.apiHash])
    try {
      if (c) out.push(decrypt(c))
    } catch {} // AUTH_SECRET changed: the patterns still apply
  return out
}

async function docker(path: string) {
  const res = await fetch(`${process.env.DOCKER_PROXY_URL}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`docker-proxy ${res.status} for ${path}`)
  return res
}

type DockerContainer = {
  Names: string[]
  State: string
  Labels: Record<string, string>
}

type SystemLogs = {
  containers: { id: string; name: string; state: string }[]
  current?: string
  tail: number
  lines: string[]
  error?: string
}

export async function loadSystemLogs(p: {
  container?: string
  tail?: string
  errors?: string
  q?: string
}): Promise<SystemLogs> {
  if ((await auth())?.user?.role !== "superadmin") throw new Error("Forbidden")
  const project = process.env.COMPOSE_PROJECT
  const tail = TAILS.includes(Number(p.tail)) ? Number(p.tail) : TAILS[0]
  const empty: SystemLogs = { containers: [], tail, lines: [] }
  if (!process.env.DOCKER_PROXY_URL || !project)
    return {
      ...empty,
      error:
        "Логи недоступны: docker-proxy не настроен (DOCKER_PROXY_URL, COMPOSE_PROJECT).",
    }
  try {
    // byte-exact query: docker-proxy/haproxy.cfg.template allows only this list request
    const filters = JSON.stringify({ label: [`${PROJECT_LABEL}=${project}`] })
    const all: DockerContainer[] = await (
      await docker(
        `/containers/json?all=1&filters=${encodeURIComponent(filters)}`
      )
    ).json()
    // checked again here: a container of another project must never be listed or read
    const containers = all
      .filter((c) => c.Labels?.[PROJECT_LABEL] === project)
      .map((c) => ({
        id: c.Names[0].slice(1), // the proxy allows logs only by this project's container names
        name: c.Labels["com.docker.compose.service"] ?? c.Names[0].slice(1),
        state: c.State,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const current =
      containers.find((c) => c.name === p.container) ?? containers[0]
    if (!current) return { ...empty, containers }
    const raw = await docker(
      `/containers/${current.id}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`
    )
    const q = p.q?.toLowerCase()
    const lines = mask(
      demux(Buffer.from(await raw.arrayBuffer())),
      await panelSecrets()
    )
      .split("\n")
      .filter(
        (l) =>
          l &&
          (!p.errors || ERRORS.test(l)) &&
          (!q || l.toLowerCase().includes(q))
      )
    return { containers, current: current.name, tail, lines }
  } catch (e) {
    console.error("system logs:", e)
    return { ...empty, error: "docker-proxy не ответил, см. логи web." }
  }
}
