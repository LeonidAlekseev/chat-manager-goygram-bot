"use client"

import Link from "next/link"
import { signOut, useSession } from "next-auth/react"
import { LogOut, User } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function UserDropdown() {
  const login = useSession().data?.user?.name ?? ""

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="rounded-lg shadow-sm"
          aria-label="Пользователь"
        >
          <User className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent forceMount>
        <DropdownMenuLabel className="truncate">{login}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">Профиль</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut({ redirectTo: "/login" })}>
          <LogOut className="me-2 size-4" />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
