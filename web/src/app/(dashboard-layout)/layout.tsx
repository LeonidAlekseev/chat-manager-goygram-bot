import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { SessionProvider } from "next-auth/react"

import { Layout } from "@/components/layout"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  return (
    <SessionProvider session={session}>
      <Layout>{children}</Layout>
    </SessionProvider>
  )
}
