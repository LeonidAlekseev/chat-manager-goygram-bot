"use client"

import { Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { ActionForm } from "@/components/action-form"

// Trash icon button. In a list put it OUTSIDE <summary> (iOS Safari may toggle instead of submit) and
// pass a className that positions it over the `relative` card; its error floats under the icon.
export function DeleteForm({
  action,
  id,
  label,
  confirmText,
  className,
}: {
  action: (formData: FormData) => Promise<{ error?: string } | void>
  id: number
  label: string // «Удалить …»: the aria-label
  confirmText: string
  className?: string
}) {
  return (
    <ActionForm
      action={action}
      confirmText={confirmText}
      className={cn(
        "[&>p]:absolute [&>p]:right-0 [&>p]:top-full [&>p]:z-10 [&>p]:mt-1 [&>p]:w-56 [&>p]:rounded-xl [&>p]:border [&>p]:bg-card [&>p]:p-2 [&>p]:text-right",
        className
      )}
    >
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="outline"
        size="icon"
        aria-label={label}
        className="text-destructive hover:bg-destructive-soft hover:text-destructive"
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </ActionForm>
  )
}
