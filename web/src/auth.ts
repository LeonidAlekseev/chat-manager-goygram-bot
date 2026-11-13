import NextAuth from "next-auth"
import { z } from "zod"

import type { SessionUser } from "@/lib/credentials"
import type { DefaultSession } from "next-auth"

import { activeSessionUser, verifyCredentials } from "@/lib/credentials"

import Credentials from "next-auth/providers/credentials"

declare module "next-auth" {
  interface User {
    role?: SessionUser["role"]
  }
  interface Session {
    user: {
      role?: SessionUser["role"]
    } & DefaultSession["user"]
  }
}
const LoginSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true, // panel runs behind the owner's reverse proxy
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    // Re-check the DB on every session read so a disabled manager loses access at once.
    async jwt({ token, user }) {
      if (user) token.uid = Number(user.id)
      const current = token.uid
        ? await activeSessionUser(token.uid as number)
        : null
      if (!current) return null
      token.role = current.role
      return token
    },
    session({ session, token }) {
      session.user.role = token.role as SessionUser["role"]
      return session
    },
  },
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
