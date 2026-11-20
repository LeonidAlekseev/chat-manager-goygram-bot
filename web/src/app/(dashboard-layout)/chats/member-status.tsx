import Link from "next/link"
import { CircleAlert, Info } from "lucide-react"

import { Badge } from "@/components/ui/badge"

// #99: the bot checks with getChatMember whether an assigned manager is a chat admin; NULL = not checked yet.
const HINT =
  "/all работает для администраторов чата и назначенных менеджеров, если вы состоите в чате"

// the manager's own badge: only where they are not in the chat (a plain member can use /all too)
export function NotAdminBadge({ status }: { status: string | null }) {
  return status === "absent" ? (
    <Badge variant="destructive" title={HINT} className="w-fit">
      <CircleAlert aria-hidden />
      Вас нет в чате
    </Badge>
  ) : null
}

export function NotAdminHint({ linked }: { linked: boolean }) {
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
