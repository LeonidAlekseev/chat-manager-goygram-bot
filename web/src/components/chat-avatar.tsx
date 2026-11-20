"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

// The group's photo from the bot (#113), or the title's first letter when there is none or it fails to load.
// Pass only these fields from a server page: everything in `chat` is sent to the browser.
export function ChatAvatar({
  chat,
  className,
}: {
  chat: { id: number; title: string; photo: { uniqueId: string } | null }
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const img = useRef<HTMLImageElement>(null)
  // an image that failed before hydration fired its error event with no handler attached yet
  useEffect(() => {
    if (img.current?.complete && img.current.naturalWidth === 0) setBroken(true)
  }, [])
  return chat.photo && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element -- a tiny private image; next/image would proxy it for nothing
    <img
      ref={img}
      src={`/api/chats/${chat.id}/photo?v=${chat.photo.uniqueId}`}
      alt="" // decorative: the chat's title is always next to it
      width={32}
      height={32}
      onError={() => setBroken(true)}
      className={cn("size-8 shrink-0 rounded-full object-cover", className)}
    />
  ) : (
    <span
      aria-hidden
      // className last: a caller's size, shape and colors win
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-black uppercase text-primary",
        className
      )}
    >
      {chat.title.slice(0, 1)}
    </span>
  )
}
