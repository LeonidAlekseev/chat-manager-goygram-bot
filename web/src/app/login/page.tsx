"use client"

import { useActionState } from "react"
import { LogIn, Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { login } from "./actions"

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null)

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-6 p-4">
      <p className="flex items-center gap-2">
        <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Send className="size-5" aria-hidden />
        </span>
        <span className="text-2xl font-black tracking-tight">TaskManager</span>
      </p>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl font-black">Вход в панель</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={action} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="login">Логин</Label>
              <Input id="login" name="login" autoComplete="username" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              <LogIn />
              Войти
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
