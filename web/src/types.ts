import type { LucideIcon } from "lucide-react"
import type { ComponentType, SVGAttributes } from "react"

export type LayoutType = "vertical" | "horizontal"

export type OrientationType = "vertical" | "horizontal"

export type DirectionType = "ltr" | "rtl"

export type LocaleType = "en"

export type ThemeType = string

export type RadiusType = number

export type SettingsType = {
  theme: ThemeType
  radius: RadiusType
  layout: LayoutType
  locale: LocaleType
}

export interface IconProps extends SVGAttributes<SVGElement> {
  children?: never
  color?: string
}

export type IconType = ComponentType<IconProps> | LucideIcon
