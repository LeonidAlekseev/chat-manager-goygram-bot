import { decrypt } from "@/lib/crypto"
import { db } from "@/lib/db"

// The panel never shows a stored secret, only its last 4 characters.
function mask(cipher: string | null) {
  if (!cipher) return null
  try {
    return "••••" + decrypt(cipher).slice(-4)
  } catch {
    return "не расшифровывается" // AUTH_SECRET changed: re-enter the value
  }
}

export async function settingsView() {
  const s = await db.settings.findUnique({ where: { id: 1 } })
  return {
    botToken: mask(s?.botToken ?? null),
    apiId: s?.apiId ?? null,
    apiHash: mask(s?.apiHash ?? null),
    botUsername: s?.botUsername ?? null,
  }
}

// The bot writes bot_seen_at every few seconds (bot/bot/account.py).
const ALIVE_MS = 60_000

export async function accountView() {
  const [s, login] = await Promise.all([
    db.settings.findUnique({ where: { id: 1 } }),
    db.mtprotoLogin.findUnique({ where: { id: 1 } }),
  ])
  const alive = !!s?.botSeenAt && Date.now() - +s.botSeenAt < ALIVE_MS
  return {
    account: s?.apiAccount ?? null,
    bot: s?.botError
      ? `ошибка: ${s.botError}`
      : alive
        ? "работает"
        : "не запущен",
    login: {
      pending: !!login?.step,
      state: login?.state ?? null,
      error: login?.error ?? null,
    },
  }
}
