import { NextResponse } from "next/server"
import { auth } from "@/auth"

// Defense in depth: pages still call auth() themselves; this stops anonymous requests before any render.
export default auth((req) => {
  if (req.auth) return
  if (req.nextUrl.pathname.startsWith("/api/"))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.redirect(new URL("/login", req.nextUrl))
})

export const config = {
  // Node, not Edge: the jwt callback re-reads `active` via Prisma, so a disabled manager is cut off here too.
  runtime: "nodejs",
  matcher: ["/((?!login$|api/auth/|_next/|favicon\\.ico$|images/).*)"],
}
