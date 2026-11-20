import { Copy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ActionForm } from "@/components/action-form"

// «Дублировать»: the server makes a copy owned by the viewer, so it is editable even when the original is not.
export function DuplicateForm({
  action,
  id,
  name,
}: {
  action: (formData: FormData) => Promise<{ error?: string } | void>
  id: number
  name: string
}) {
  return (
    <ActionForm action={action} className="grid gap-1">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="outline"
        className="w-fit"
        aria-label={`Дублировать «${name}»`}
      >
        <Copy />
        Дублировать
      </Button>
    </ActionForm>
  )
}
