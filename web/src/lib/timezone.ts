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
