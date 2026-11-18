import { Button } from "@/components/ui/button"
import { ActionForm } from "@/components/action-form"
import { deleteChat } from "./actions"

export function DeleteChatForm({
  chat,
}: {
  chat: { id: number; title: string }
}) {
  return (
    <ActionForm
      action={deleteChat}
      confirmText={`Бот выйдет из группы «${chat.title}», чат и его журнал отправок будут удалены. Продолжить?`}
    >
      <input type="hidden" name="id" value={chat.id} />
      <Button type="submit" variant="outline">
        Удалить
      </Button>
    </ActionForm>
  )
}
