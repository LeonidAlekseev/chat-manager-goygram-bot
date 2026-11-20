// The panel and the bot both read schedule times in this zone.
export const TIMEZONE = process.env.TIMEZONE_NAME || "Europe/Moscow"

/** Current "YYYY-MM-DD HH:MM" in `timeZone` (the browser does not see TIMEZONE_NAME). */
export function nowInZone(timeZone = TIMEZONE): string {
  return new Date().toLocaleString("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** The instant of local "YYYY-MM-DDTHH:MM" in `TIMEZONE`.
 * shortcut: one offset lookup, so a time inside a DST jump may be off by an hour; fine for zones without DST (Moscow). */
export function zonedToUtc(local: string): Date {
  const guess = new Date(`${local}Z`)
  const shown = guess
    .toLocaleString("sv-SE", { timeZone: TIMEZONE })
    .replace(" ", "T")
  return new Date(2 * guess.getTime() - new Date(`${shown}Z`).getTime())
}
