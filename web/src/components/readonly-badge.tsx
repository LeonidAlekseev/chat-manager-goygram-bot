import { Lock } from "lucide-react"

import { Badge } from "@/components/ui/badge"

// A schedule or template the viewer sees but may not edit (the superadmin's, for a manager).
export function ReadOnlyBadge() {
  return (
    <Badge
      variant="secondary"
      title="Только суперадмин меняет"
      className="whitespace-nowrap"
    >
      <Lock aria-hidden />
      Неизменяемый
    </Badge>
  )
}
