import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { Bot, KeyRound } from "lucide-react"

import type { Metadata } from "next"

import { accountView, settingsView } from "@/lib/settings"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AccountForm } from "./account-form"
import { SettingsForm } from "./settings-form"

export const metadata: Metadata = { title: "Настройки" }
export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "superadmin") redirect("/chats")
  const [current, account] = await Promise.all([settingsView(), accountView()])

  return (
    <section className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle icon={Bot}>Telegram</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="w-fit rounded-xl bg-background px-3 py-2 text-sm">
            Состояние бота: <b>{account.bot}</b>
          </p>
          <SettingsForm current={current} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle icon={KeyRound}>Аккаунт Telegram (MTProto)</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountForm view={account} />
        </CardContent>
      </Card>
    </section>
  )
}
