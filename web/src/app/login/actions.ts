"use server"

import { signIn } from "@/auth"
import { AuthError } from "next-auth"

export async function login(_prev: string | null, formData: FormData) {
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
