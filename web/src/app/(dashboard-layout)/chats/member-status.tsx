import Link from "next/link"
import { CircleAlert, Info } from "lucide-react"

import { Badge } from "@/components/ui/badge"

// #99: the bot still records admin/member/absent via getChatMember (NULL = not checked yet).
// The superadmin sees all statuses; a manager gets a badge only when absent from the chat
// (/all is open to assigned managers since #120).
const HINT =
  "/all работает для администраторов чата и назначенных менеджеров, если вы состоите в чате"

// the manager's own badge: only where they are not in the chat (a plain member can use /all too)
export function AbsentBadge({ status }: { status: string | null }) {
  return status === "absent" ? (
    <Badge variant="destructive" title={HINT} className="w-fit">
      <CircleAlert aria-hidden />
      Вас нет в чате
    </Badge>
  ) : null
}

export function MentionHint({ linked }: { linked: boolean }) {
  return (
    <p className="flex gap-2 rounded-xl bg-primary-soft p-3 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <span>
        {linked ? (
          `${HINT}.`
        ) : (
          <>
            <Link href="/profile" className="underline underline-offset-4">
              Привяжите Telegram в профиле
            </Link>
            , чтобы пользоваться /all в своих чатах.
          </>
        )}
      </span>
    </p>
  )
}

const FOR_SUPER: Record<string, string> = {
  admin: "Администратор",
  member: "Не администратор",
  absent: "Нет в чате",
  unknown: "Не удалось проверить",
}

// the superadmin's view of an assigned manager
export const managerStatus = (status: string | null, linked: boolean) =>
  linked ? (FOR_SUPER[status ?? ""] ?? "Проверяется…") : "Telegram не привязан"
