import type { NavigationType } from "@/types"

export const navigationsData: NavigationType[] = [
  {
    title: "Управление",
    items: [
      { title: "Чаты", href: "/chats", iconName: "MessagesSquare" },
      { title: "Шаблоны", href: "/templates", iconName: "FileText" },
      { title: "Расписания", href: "/schedules", iconName: "CalendarClock" },
      { title: "Отправка", href: "/send", iconName: "Send" },
      { title: "Журнал", href: "/logs", iconName: "ScrollText" },
    ],
  },
]

export const adminNavigationsData: NavigationType[] = [
  {
    title: "Администрирование",
    items: [{ title: "Менеджеры", href: "/managers", iconName: "Users" }],
  },
]
