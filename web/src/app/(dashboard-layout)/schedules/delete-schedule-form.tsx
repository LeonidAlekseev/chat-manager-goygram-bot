import { DeleteForm } from "@/components/delete-form"
import { deleteSchedule } from "./actions"

export function DeleteScheduleForm({
  id,
  name,
  chats,
}: {
  id: number
  name: string
  chats: number
}) {
  return (
    <DeleteForm
      action={deleteSchedule}
      id={id}
      label={`Удалить расписание «${name}»`}
      confirmText={`Удалить расписание? Привязанных чатов: ${chats} — они будут отвязаны.`}
      className="absolute right-2 top-2"
    />
  )
}
