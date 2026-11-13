import { redirect } from "next/navigation"
import { auth } from "@/auth"

import type { Metadata } from "next"

import { accountView, settingsView } from "@/lib/settings"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AccountForm } from "./account-form"
import { SettingsForm } from "./settings-form"

export const metadata: Metadata = { title: "Настройки" }
export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "superadmin") redirect("/chats")
  const [current, account] = await Promise.all([settingsView(), accountView()])

  return (
    <section className="container space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm">Состояние бота: {account.bot}</p>
          <SettingsForm current={current} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Аккаунт Telegram (MTProto)</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountForm view={account} />
        </CardContent>
      </Card>
    </section>
  )
}
