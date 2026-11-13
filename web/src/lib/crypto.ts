import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"

// Format shared with the bot (bot/bot/settings.py): base64(iv[12] | ciphertext | tag[16]),
// AES-256-GCM, key = SHA-256(AUTH_SECRET).
const key = (secret: string) => createHash("sha256").update(secret).digest()

function authSecret() {
  const s = process.env.AUTH_SECRET
  if (!s) throw new Error("AUTH_SECRET is not set")
  return s
}

export function encrypt(plain: string, secret = authSecret()) {
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", key(secret), iv)
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()])
  return Buffer.concat([iv, body, c.getAuthTag()]).toString("base64")
}

export function decrypt(token: string, secret = authSecret()) {
  const raw = Buffer.from(token, "base64")
  const d = createDecipheriv("aes-256-gcm", key(secret), raw.subarray(0, 12))
  d.setAuthTag(raw.subarray(-16))
  return Buffer.concat([d.update(raw.subarray(12, -16)), d.final()]).toString(
    "utf8"
  )
}
