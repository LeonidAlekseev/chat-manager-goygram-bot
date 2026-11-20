import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { Power, PowerOff } from "lucide-react"

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
  if (!session?.user) redirect("/login")
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {managers.map((m) => (
                    <tr
                      key={m.id}
                      className="block border-t py-2 md:table-row md:py-0"
                    >
                      <td className="block py-1 pe-4 md:table-cell md:py-2">
                        <span className="font-mono">{m.login}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          {m.telegramUserId ? (
                            <span className="font-mono text-muted-foreground">
                              {m.telegramUserId.toString()}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              Telegram не привязан
                            </span>
                          )}
                          {m.active ? (
                            <Badge>Активен</Badge>
                          ) : (
                            <Badge variant="secondary">Отключён</Badge>
                          )}
                        </span>
                      </td>
                      <td className="block py-1 pe-4 md:table-cell md:py-2">
                        <EditManagerForm
                          id={m.id}
                          login={m.login}
                          name={m.name}
                        />
                      </td>
                      <td className="block py-1 md:table-cell md:py-2">
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
                          <Button
                            type="submit"
                            variant="outline"
                            size="icon"
                            aria-label={`${m.active ? "Отключить" : "Включить"} ${m.login}`}
                            title={m.active ? "Отключить" : "Включить"}
                          >
                            {m.active ? <PowerOff /> : <Power />}
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
