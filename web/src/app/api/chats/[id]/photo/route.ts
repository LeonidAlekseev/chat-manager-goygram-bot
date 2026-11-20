import { getViewer, visibleChats } from "@/lib/access"
import { db } from "@/lib/db"

// A group's photo, stored by the bot (#113). Another manager's chat answers 404, like a missing one (#92).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const v = await getViewer()
  const id = Number((await params).id)
  const photo =
    v && Number.isInteger(id) && id >= 1 && id <= 2147483647
      ? await db.chatPhoto.findFirst({
          where: { chatId: id, chat: visibleChats(v) },
        })
      : null
  if (!photo) return new Response(null, { status: 404 })
  // the <img> URL carries ?v=<uniqueId>, so a new photo is a new URL and a day's cache is safe
  const headers = {
    ETag: `"${photo.uniqueId}"`,
    "Cache-Control": "private, max-age=86400",
  }
  if (req.headers.get("if-none-match") === headers.ETag)
    return new Response(null, { status: 304, headers })
  return new Response(photo.data, {
    headers: { ...headers, "Content-Type": photo.mime },
  })
}
