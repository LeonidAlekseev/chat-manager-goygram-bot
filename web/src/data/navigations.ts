import type { NavigationType } from "@/types"

export const navigationsData: NavigationType[] = [
  {
    title: "Управление",
    items: [
      { title: "Шаблоны", href: "/templates", iconName: "FileText" },
      { title: "Расписания", href: "/schedules", iconName: "CalendarClock" },
      { title: "Чаты", href: "/chats", iconName: "MessagesSquare" },
      { title: "Отправка", href: "/send", iconName: "Send" },
      { title: "Журнал", href: "/logs", iconName: "ScrollText" },
      { title: "Профиль", href: "/profile", iconName: "User" }, // same page as the top-right button
    ],
  },
]

export const adminNavigationsData: NavigationType[] = [
  {
    title: "Администрирование",
    items: [
      { title: "Менеджеры", href: "/managers", iconName: "Users" },
      { title: "Настройки", href: "/settings", iconName: "Settings" },
      { title: "Системные логи", href: "/system-logs", iconName: "Terminal" },
    ],
  },
]
