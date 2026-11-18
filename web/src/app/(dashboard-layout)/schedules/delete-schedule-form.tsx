"use client"

import { Button } from "@/components/ui/button"
import { ActionForm } from "@/components/action-form"
import { deleteSchedule } from "./actions"

export function DeleteScheduleForm({
  id,
  chats,
}: {
  id: number
  chats: number
}) {
  return (
    <ActionForm
      action={deleteSchedule}
      confirmText={`Удалить расписание? Привязанных чатов: ${chats} — они будут отвязаны.`}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline">
        Удалить расписание
      </Button>
    </ActionForm>
  )
}
