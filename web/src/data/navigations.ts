import {
  CalendarClock,
  FileText,
  MessagesSquare,
  ScrollText,
  Send,
  Settings,
  Terminal,
  User,
  Users,
} from "lucide-react"

// #112: the five working sections fit a phone's bottom bar; the rest live in the rail and the user menu
export const sections = [
  { title: "Чаты", href: "/chats", icon: MessagesSquare },
  { title: "Шаблоны", href: "/templates", icon: FileText },
  { title: "Расписания", href: "/schedules", icon: CalendarClock },
  { title: "Отправка", href: "/send", icon: Send },
  { title: "Журнал", href: "/logs", icon: ScrollText },
]

export const adminSections = [
  { title: "Менеджеры", href: "/managers", icon: Users },
  { title: "Настройки", href: "/settings", icon: Settings },
  { title: "Системные логи", href: "/system-logs", icon: Terminal },
]

export const profileSection = { title: "Профиль", href: "/profile", icon: User }
