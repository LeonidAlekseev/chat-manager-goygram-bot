"use server"

import { headers } from "next/headers"
import { signIn } from "@/auth"
import { AuthError } from "next-auth"

import { isLoginBlocked, loginKey } from "@/lib/loginLimit"

export async function login(_prev: string | null, formData: FormData) {
  // Only for the message: auth.ts enforces the limit itself.
  if (isLoginBlocked(loginKey(formData.get("login"), await headers())))
    return "Слишком много неудачных попыток. Повторите через 15 минут."
  try {
    await signIn("credentials", {
      ...Object.fromEntries(formData),
      redirectTo: "/chats",
    })
    return null
  } catch (e) {
    if (e instanceof AuthError) return "Неверный логин или пароль"
    throw e // NEXT_REDIRECT on success
  }
}
