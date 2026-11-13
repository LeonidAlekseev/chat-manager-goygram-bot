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
