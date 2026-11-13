import type { NavigationType } from "@/types"

export const navigationsData: NavigationType[] = [
  {
    title: "Управление",
    items: [
      { title: "Чаты", href: "/chats", iconName: "MessagesSquare" },
      { title: "Шаблоны", href: "/templates", iconName: "FileText" },
    ],
  },
]
