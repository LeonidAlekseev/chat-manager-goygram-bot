import NextAuth from "next-auth"
import { z } from "zod"

import { verifyCredentials } from "@/lib/credentials"

import Credentials from "next-auth/providers/credentials"

const LoginSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true, // panel runs behind the owner's reverse proxy
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { login: {}, password: {} },
      async authorize(raw) {
        const parsed = LoginSchema.safeParse(raw)
        if (!parsed.success) return null
        const user = await verifyCredentials(
          parsed.data.login,
          parsed.data.password
        )
        return (
          user && { id: String(user.id), name: user.login, role: user.role }
        )
      },
    }),
  ],
})
