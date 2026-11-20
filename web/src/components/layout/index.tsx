"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
import { LogOut, Send } from "lucide-react"

import type { ReactNode } from "react"

import { adminSections, profileSection, sections } from "@/data/navigations"

import { cn, isActivePathname } from "@/lib/utils"

import { UserDropdown } from "./user-dropdown"

type Section = (typeof sections)[number]

// #112: the /v2 shell — a rail on desktop; a frosted header and a five-section bottom bar on a phone.
export function Layout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const user = useSession().data?.user
  const superadmin = user?.role === "superadmin"
  const admin = superadmin ? adminSections : []
  const current = [...sections, ...admin, profileSection].find((s) =>
    isActivePathname(s.href, pathname)
  )
  const role = superadmin ? "Суперадмин" : "Менеджер"

  return (
    <div className="min-h-dvh w-full lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      {/* the column carries the white background and border down the whole page; the menu itself stays on screen */}
      <div className="hidden border-r bg-card lg:block">
        <aside className="sticky top-0 flex h-dvh flex-col gap-6 overflow-y-auto p-5">
          <Brand />
          <nav aria-label="Разделы" className="grid gap-1">
            {sections.map((s) => (
              <RailLink key={s.href} s={s} current={s === current} />
            ))}
            {admin.length > 0 && (
              <p className="mt-4 mb-1 px-3 text-xs font-bold text-muted-foreground">
                Администрирование
              </p>
            )}
            {admin.map((s) => (
              <RailLink key={s.href} s={s} current={s === current} />
            ))}
            <p className="mt-4 mb-1 px-3 text-xs font-bold text-muted-foreground">
              Аккаунт
            </p>
            <RailLink s={profileSection} current={profileSection === current} />
          </nav>
          <div className="mt-auto flex items-center gap-3 rounded-xl bg-background p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-black text-primary-foreground uppercase">
              {(user?.name ?? "?").slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1 text-sm">
              <span className="block truncate font-bold">{user?.name}</span>
              <span className="text-muted-foreground">{role}</span>
            </span>
            <button
              type="button"
              onClick={() => signOut({ redirectTo: "/login" })}
              aria-label="Выйти"
              title="Выйти"
              className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <LogOut className="size-5" aria-hidden />
            </button>
          </div>
        </aside>
      </div>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-card/85 px-4 py-2 backdrop-blur-md lg:hidden">
          <Brand />
          <UserDropdown admin={admin} />
        </header>
        <main className="mx-auto grid max-w-6xl content-start gap-4 px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-8 lg:pb-10">
          {current && (
            <div className="min-w-0">
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
                {current.title}
              </h1>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {role} · {user?.name}
              </p>
            </div>
          )}
          {children}
        </main>
      </div>

      {/* phone tab bar: five sections fit, so no "more" menu */}
      <nav
        aria-label="Разделы"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        {sections.map(({ title, href, icon: Icon }) => {
          const on = current?.href === href
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-bold text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                on && "text-primary"
              )}
            >
              <span
                className={cn(
                  "grid h-7 w-12 place-items-center rounded-full transition-colors duration-150",
                  on && "bg-primary-soft"
                )}
              >
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="max-w-full truncate">{title}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

function RailLink({ s, current }: { s: Section; current: boolean }) {
  const Icon = s.icon
  return (
    <Link
      href={s.href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold text-muted-foreground transition-colors duration-150 hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        current &&
          "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary"
      )}
    >
      <Icon className="size-5" aria-hidden />
      {s.title}
    </Link>
  )
}

export function Brand() {
  return (
    <Link
      href="/chats"
      className="flex w-fit items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Send className="size-4" aria-hidden />
      </span>
      <span className="text-lg font-black tracking-tight">TaskManager</span>
    </Link>
  )
}
