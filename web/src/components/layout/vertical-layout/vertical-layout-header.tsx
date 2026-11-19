"use client"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { UserDropdown } from "@/components/layout/user-dropdown"
import { ToggleMobileSidebar } from "../toggle-mobile-sidebar"

export function VerticalLayoutHeader() {
  return (
    // Zero-height sticky strip: no bar, only the two buttons float over the content.
    <header className="sticky top-0 z-50 h-0 w-full">
      <div className="container flex justify-between items-center gap-4 pt-3">
        <ToggleMobileSidebar />
        <SidebarTrigger
          variant="outline"
          className="hidden lg:flex rounded-lg shadow-sm"
        />
        <UserDropdown />
      </div>
    </header>
  )
}
