import { redirect } from "next/navigation"
import { auth } from "@/auth"

import type { Metadata } from "next"

import { db } from "@/lib/db"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { setManagerActive } from "./actions"
import { CreateManagerForm } from "./create-manager-form"
import { EditManagerForm } from "./edit-manager-form"

export const metadata: Metadata = { title: "Менеджеры" }

export default async function ManagersPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "superadmin") redirect("/chats")
  const managers = await db.manager.findMany({
    where: { role: "manager" },
    orderBy: [{ active: "desc" }, { login: "asc" }],
  })

  return (
    <section className="container space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Новый менеджер</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateManagerForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Менеджеры</CardTitle>
        </CardHeader>
        <CardContent>
          {managers.length === 0 ? (
            <p className="text-muted-foreground">Менеджеров пока нет.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {managers.map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="py-2 pe-4 font-mono">{m.login}</td>
                    <td className="py-2 pe-4">
                      <EditManagerForm
                        id={m.id}
                        login={m.login}
                        name={m.name}
                      />
                    </td>
                    <td className="py-2">
                      <form
                        action={setManagerActive}
                        className="flex items-center gap-2"
                      >
                        <input type="hidden" name="id" value={m.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={String(!m.active)}
                        />
                        {m.active ? (
                          <Badge>Активен</Badge>
                        ) : (
                          <Badge variant="secondary">Отключён</Badge>
                        )}
                        <Button type="submit" variant="outline">
                          {m.active ? "Отключить" : "Включить"}
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
