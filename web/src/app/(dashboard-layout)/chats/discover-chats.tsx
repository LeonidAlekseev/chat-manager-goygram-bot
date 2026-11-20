"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import type { ChatDiscovery } from "@prisma/client"

import { Button } from "@/components/ui/button"
import { ActionForm } from "@/components/action-form"
import { discoverChats } from "./actions"

export function DiscoverChats({
  scan,
}: {
  scan: Pick<ChatDiscovery, "state" | "found" | "added" | "error"> | null
}) {
  const router = useRouter()
  const busy = scan?.state === "queued" || scan?.state === "running"
  // the bot takes a scan within seconds and may need minutes for it: poll until it reports
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => router.refresh(), 2000)
    return () => clearInterval(t)
  }, [busy, router])

  return (
    <ActionForm action={discoverChats} className="mb-4 grid gap-2">
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="outline">
          Найти группы бота
        </Button>
        {busy ? (
          <span role="status" className="text-sm text-muted-foreground">
            Ищем группы…
          </span>
        ) : (
          scan && (
            <span role="status" className="text-sm">
              Найдено {scan.found ?? 0}, добавлено {scan.added ?? 0}
            </span>
          )
        )}
      </div>
      {!busy && scan?.error && (
        <p className="text-sm text-destructive">{scan.error}</p>
      )}
      <p className="text-sm text-muted-foreground">
        Найдутся только группы, где состоят и бот, и подключённый в Настройках
        аккаунт Telegram.
      </p>
    </ActionForm>
  )
}
