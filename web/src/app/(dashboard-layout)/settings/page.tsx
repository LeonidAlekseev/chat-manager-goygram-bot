import { redirect } from "next/navigation"
import { auth } from "@/auth"

import type { Metadata } from "next"

import { settingsView } from "@/lib/settings"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SettingsForm } from "./settings-form"

export const metadata: Metadata = { title: "Настройки" }

export default async function SettingsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "superadmin") redirect("/chats")

  return (
    <section className="container space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm current={await settingsView()} />
        </CardContent>
      </Card>
    </section>
  )
}
