import type { NavigationType } from "@/types"

export const navigationsData: NavigationType[] = [
  {
    title: "Управление",
    items: [{ title: "Чаты", href: "/chats", iconName: "MessagesSquare" }],
  },
]

export const adminNavigationsData: NavigationType[] = [
  {
    title: "Администрирование",
    items: [{ title: "Менеджеры", href: "/managers", iconName: "Users" }],
  },
]
