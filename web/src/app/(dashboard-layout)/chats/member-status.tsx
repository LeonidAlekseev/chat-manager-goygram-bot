import Link from "next/link"

import { Badge } from "@/components/ui/badge"

// #99: the bot checks with getChatMember whether an assigned manager is a chat admin; NULL = not checked yet.
const HINT = "Команды бота, например /all, доступны только администраторам чата"

const NOT_ADMIN: Record<string, string> = {
  member: "Вы не администратор",
  absent: "Вас нет в чате",
}

// the manager's own badge: only where something is wrong
export function NotAdminBadge({ status }: { status: string | null }) {
  const label = NOT_ADMIN[status ?? ""]
  return label ? (
    <Badge variant="destructive" title={HINT} className="w-fit">
      {label}
    </Badge>
  ) : null
}

export function NotAdminHint({ linked }: { linked: boolean }) {
  return (
    <p className="text-sm text-muted-foreground">
      {linked ? (
        `${HINT}.`
      ) : (
        <>
          <Link href="/profile" className="underline underline-offset-4">
            Привяжите Telegram в профиле
          </Link>
          , чтобы видеть, в каких чатах вы не администратор.
        </>
      )}
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
