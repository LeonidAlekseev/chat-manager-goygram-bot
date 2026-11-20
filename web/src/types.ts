import type { LucideIcon } from "lucide-react"
import type { ComponentType, SVGAttributes } from "react"

export interface IconProps extends SVGAttributes<SVGElement> {
  children?: never
  color?: string
}

export type IconType = ComponentType<IconProps> | LucideIcon
