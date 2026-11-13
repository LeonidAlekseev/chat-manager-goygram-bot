import { useSession } from "next-auth/react"

import { adminNavigationsData, navigationsData } from "@/data/navigations"

export function useNavigations() {
  const role = useSession().data?.user?.role
  return role === "superadmin"
    ? [...navigationsData, ...adminNavigationsData]
    : navigationsData
}
