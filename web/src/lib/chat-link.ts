// t.me link for a chat. Only supergroups/channels (-100<id>) have a link that opens for members;
// shortcut: a public @username is not stored, so no t.me/<username> — add it when the bot saves one.
export function chatLink(telegramId: bigint): string | null {
  const s = telegramId.toString()
  return s.startsWith("-100") ? `https://t.me/c/${s.slice(4)}` : null
}
