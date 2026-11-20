"use client"

import Link from "next/link"
import { signOut, useSession } from "next-auth/react"
import { LogOut, User } from "lucide-react"

import type { adminSections } from "@/data/navigations"

import { profileSection } from "@/data/navigations"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// the phone's account menu: the profile and, for the superadmin, the sections the bottom bar has no room for
export function UserDropdown({ admin }: { admin: typeof adminSections }) {
  const login = useSession().data?.user?.name ?? ""

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Пользователь">
          <User className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent forceMount align="end" className="min-w-52">
        <DropdownMenuLabel className="truncate">{login}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {[profileSection, ...admin].map(({ title, href, icon: Icon }) => (
          <DropdownMenuItem key={href} asChild className="min-h-11">
            <Link href={href}>
              <Icon className="me-2 size-4" aria-hidden />
              {title}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-11"
          onSelect={() => signOut({ redirectTo: "/login" })}
        >
          <LogOut className="me-2 size-4" />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
