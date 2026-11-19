import { DeleteForm } from "@/components/delete-form"
import { deleteChat } from "./actions"

export function DeleteChatForm({
  chat,
  className,
}: {
  chat: { id: number; title: string }
  className?: string
}) {
  return (
    <DeleteForm
      action={deleteChat}
      id={chat.id}
      label={`Удалить чат «${chat.title}»`}
      confirmText={`Бот выйдет из группы «${chat.title}», чат и его журнал отправок будут удалены. Продолжить?`}
      className={className}
    />
  )
}
