import { expect, test } from "@playwright/test"
import { PrismaClient } from "@prisma/client"

import type { Locator } from "@playwright/test"

import { LOGIN, PASSWORD } from "../playwright.config"
import { CHAT } from "./global-setup"

test.use({ viewport: { width: 390, height: 844 } })

test("mobile: no horizontal overflow, chat title visible, light only, TaskManager", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" }) // the panel ignores the system theme
  await page.goto("/login")
  await page.getByLabel("Логин").fill(LOGIN)
  await page.getByLabel("Пароль").fill(PASSWORD)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")

  await expect(page.getByLabel(/Название чата/).first()).toBeVisible()
  await expect(page.locator(`input[value="${CHAT}"]`)).toBeVisible()
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  ).toBe("rgb(255, 255, 255)")
  await expect(page.getByText("Qualiora")).toHaveCount(0)

  for (const path of [
    "/chats",
    "/templates",
    "/schedules",
    "/logs",
    "/send",
    "/managers",
    "/profile",
    "/settings",
  ]) {
    await page.goto(path)
    await expect(page).toHaveTitle(/TaskManager/)
    // body's overflow-x-hidden would mask a real overflow: measure without it
    await page.addStyleTag({ content: "body{overflow-x:visible!important}" })
    await page.evaluate(() =>
      document.querySelectorAll("details").forEach((d) => (d.open = true))
    )
    const [scroll, inner] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ])
    expect(scroll, `${path} overflows`).toBeLessThanOrEqual(inner)
  }

  // manager row: name, password and the save button share one line
  await page.goto("/managers")
  const save = page.getByRole("button", { name: "Сохранить" }).first()
  const pw = page.getByLabel(/Новый пароль/).first()
  const [a, b] = await Promise.all([save.boundingBox(), pw.boundingBox()])
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(20)
})

test("mobile: delete buttons fit the screen; deleting a chat hands it to the bot", async ({
  page,
}) => {
  const db = new PrismaClient()
  const name = `E2E del ${Date.now()}`
  const chat = await db.chat.create({
    data: { telegramId: BigInt(-Date.now()), title: name },
  })
  const tpl = await db.template.create({
    data: { name, kind: "text", text: "x" },
  })
  const sch = await db.schedule.create({ data: { name } })
  try {
    await page.goto("/login")
    await page.getByLabel("Логин").fill(LOGIN)
    await page.getByLabel("Пароль").fill(PASSWORD)
    await page.getByRole("button", { name: "Войти" }).click()
    await page.waitForURL("**/chats")

    const fits = async (button: Locator) => {
      await button.scrollIntoViewIfNeeded()
      await expect(button).toBeVisible()
      const box = (await button.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
    }
    for (const path of ["/templates", "/schedules"]) {
      await page.goto(path)
      const item = page
        .locator("details")
        .filter({ has: page.locator("summary", { hasText: name }) })
        .locator("xpath=..")
      await fits(item.getByRole("button", { name: "Удалить" })) // closed block
    }
    await page.goto("/chats")
    const row = page.locator("div.border-t").filter({
      has: page.locator(`input[value="${name}"]`),
    })
    await fits(row.getByRole("button", { name: "Удалить" }))
    page.once("dialog", (d) => {
      expect(d.message()).toContain(`«${name}»`)
      void d.accept()
    })
    await row.getByRole("button", { name: "Удалить" }).click()
    await expect(row.getByText("Удаляется…")).toBeVisible()
    await expect(row.getByRole("button", { name: "Удалить" })).toHaveCount(0)
    expect(
      (await db.chat.findUniqueOrThrow({ where: { id: chat.id } })).deleting
    ).toBe(true)
  } finally {
    await db.chat.deleteMany({ where: { id: chat.id } })
    await db.schedule.deleteMany({ where: { id: sch.id } })
    await db.template.deleteMany({ where: { id: tpl.id } })
    await db.$disconnect()
  }
})

test("mobile: deleting a schedule and a template from the closed list removes the row", async ({
  page,
  hasTouch,
}) => {
  const db = new PrismaClient()
  const name = `E2E rm ${Date.now()}`
  await db.template.create({ data: { name, kind: "text", text: "x" } })
  await db.schedule.create({ data: { name } })
  try {
    await page.goto("/login")
    await page.getByLabel("Логин").fill(LOGIN)
    await page.getByLabel("Пароль").fill(PASSWORD)
    await page.getByRole("button", { name: "Войти" }).click()
    await page.waitForURL("**/chats")
    for (const path of ["/schedules", "/templates"]) {
      await page.goto(path)
      const item = page
        .locator("details")
        .filter({ has: page.locator("summary", { hasText: name }) })
        .locator("xpath=..")
      page.once("dialog", (d) => void d.accept())
      const button = item.getByRole("button", { name: "Удалить" })
      await (hasTouch ? button.tap() : button.click()) // a finger, as on the phone
      await expect(item).toHaveCount(0)
      const left =
        path === "/schedules"
          ? await db.schedule.count({ where: { name } })
          : await db.template.count({ where: { name } })
      expect(left).toBe(0)
    }
  } finally {
    await db.schedule.deleteMany({ where: { name } })
    await db.template.deleteMany({ where: { name } })
    await db.$disconnect()
  }
})

test("mobile: menu order, Профиль duplicate, profile button has an icon", async ({
  page,
}) => {
  await page.goto("/login")
  await page.getByLabel("Логин").fill(LOGIN)
  await page.getByLabel("Пароль").fill(PASSWORD)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")
  const profile = page.getByRole("button", { name: "Пользователь" })
  await expect(profile.locator("svg")).toBeVisible()
  await page.screenshot({
    path: "/tmp/shots70/header.png",
    clip: { x: 0, y: 0, width: 390, height: 80 },
  })
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click()
  const links = page.locator("[data-sidebar=menu-button]")
  await expect(links.nth(0)).toHaveText("Шаблоны")
  await expect(links.nth(1)).toHaveText("Расписания")
  await expect(links.nth(2)).toHaveText("Чаты")
  await expect(
    page.getByRole("link", { name: "Профиль" }).first()
  ).toHaveAttribute("href", "/profile")
  await page.waitForTimeout(500) // the drawer slides in
  await page.screenshot({ path: "/tmp/shots70/menu.png" })
})

test("mobile: a dropped connection shows a message and the button works again", async ({
  page,
}) => {
  const db = new PrismaClient()
  const name = `E2E net ${Date.now()}`
  await db.schedule.create({ data: { name } })
  try {
    await page.goto("/login")
    await page.getByLabel("Логин").fill(LOGIN)
    await page.getByLabel("Пароль").fill(PASSWORD)
    await page.getByRole("button", { name: "Войти" }).click()
    await page.waitForURL("**/chats")
    await page.goto("/schedules")
    const row = page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: name }) })
      .locator("xpath=..")
    const button = row.getByRole("button", { name: "Удалить" })
    page.on("dialog", (d) => void d.accept())
    await page.route("**/schedules", (r) =>
      r.request().method() === "POST" ? r.abort() : r.continue()
    )
    await button.click()
    await expect(row.getByRole("alert")).toHaveText(/Нет связи с сервером/)
    await expect(button).toBeEnabled()
    expect(await db.schedule.count({ where: { name } })).toBe(1)
  } finally {
    await db.schedule.deleteMany({ where: { name } })
    await db.$disconnect()
  }
})

test("mobile: menu and profile buttons float over content with the same style, no header bar", async ({
  page,
}) => {
  await page.goto("/login")
  await page.getByLabel("Логин").fill(LOGIN)
  await page.getByLabel("Пароль").fill(PASSWORD)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")

  const menu = page.getByRole("button", { name: "Toggle Sidebar" })
  const profile = page.getByRole("button", { name: "Пользователь" })
  const style = (l: Locator) =>
    l.evaluate((el) => {
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return {
        border: s.border,
        radius: s.borderRadius,
        bg: s.backgroundColor,
        shadow: s.boxShadow,
        w: r.width,
        h: r.height,
      }
    })

  await page.evaluate(() => (document.body.style.minHeight = "3000px"))
  await page.evaluate(() => window.scrollTo(0, 600))
  await expect(menu).toBeInViewport()
  await expect(profile).toBeInViewport()
  const [m, p] = [await style(menu), await style(profile)]
  expect(m).toEqual(p)
  expect(m.bg).toBe("rgb(255, 255, 255)")
  // no bar: the header strip has no height, border or background
  expect(
    await page.evaluate(() => {
      const h = document.querySelector("header")!
      const s = getComputedStyle(h)
      return [h.offsetHeight, s.borderBottomWidth, s.backgroundColor]
    })
  ).toEqual([0, "0px", "rgba(0, 0, 0, 0)"])
  const [scroll, inner] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ])
  expect(scroll).toBeLessThanOrEqual(inner)
})

test("mobile: send — template, own text or own poll, now or later; cancel a scheduled one", async ({
  page,
}) => {
  const db = new PrismaClient()
  const text = `E2E send ${Date.now()}`
  const question = `E2E poll ${Date.now()}`
  try {
    await page.goto("/login")
    await page.getByLabel("Логин").fill(LOGIN)
    await page.getByLabel("Пароль").fill(PASSWORD)
    await page.getByRole("button", { name: "Войти" }).click()
    await page.waitForURL("**/chats")
    await page.goto("/send")
    await expect(page.getByText("Отправить сообщение")).toBeVisible()
    // own poll is the default
    await expect(page.getByLabel("Свой опрос")).toBeChecked()
    await expect(page.getByRole("textbox", { name: "Вопрос" })).toBeVisible()
    await page.getByLabel("Шаблон", { exact: true }).check()
    await expect(page.getByRole("combobox", { name: "Шаблон" })).toBeVisible()
    await expect(page.getByRole("textbox", { name: "Вопрос" })).toHaveCount(0)
    await page.getByLabel("Свой текст").check()
    await expect(page.getByRole("combobox", { name: "Шаблон" })).toHaveCount(0)
    await page.getByRole("textbox", { name: "Текст" }).fill(text)
    await page.getByLabel("Отметить всех").check()
    await page.getByLabel(CHAT).check()
    await page.screenshot({ path: "/tmp/shots80/send.png" })
    await page.getByRole("button", { name: "Отправить" }).click()
    await expect(page.getByText("Поставлено в очередь.")).toBeVisible()
    const job = await db.outbox.findFirstOrThrow({ where: { text } })
    expect([job.templateId, job.mentionAll, job.sendAt]).toEqual([
      null,
      true,
      null,
    ])

    await page.reload()
    await page.getByRole("textbox", { name: "Вопрос" }).fill(question)
    await page.getByRole("textbox", { name: "Варианты" }).fill("Да\nНет")
    await page.getByLabel("Анонимный").check()
    await page.getByLabel(CHAT).check()
    await page.getByLabel("Запланировать").check()
    await expect(page.getByText(/Дата и время \(/)).toBeVisible()
    await page.getByLabel(/Дата и время/).fill("2030-01-01T10:00")
    await page.getByRole("button", { name: "Запланировать" }).click()
    await expect(page.getByText("Запланировано.")).toBeVisible()
    const poll = await db.outbox.findFirstOrThrow({ where: { text: question } })
    expect(poll.options).toEqual(["Да", "Нет"])
    expect(poll.anonymous).toBe(true)
    expect(poll.sendAt).not.toBeNull()

    await page.reload()
    const row = page.getByRole("row").filter({ hasText: question })
    await expect(row.getByText("Запланировано")).toBeVisible()
    await page.addStyleTag({ content: "body{overflow-x:visible!important}" })
    const [scroll, inner] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ])
    expect(scroll).toBeLessThanOrEqual(inner)
    page.once("dialog", (d) => d.accept())
    await row.getByRole("button", { name: "Отменить отправку" }).click()
    await expect(
      page.getByRole("row").filter({ hasText: question })
    ).toHaveCount(0)
    expect(await db.outbox.count({ where: { text: question } })).toBe(0)
  } finally {
    await db.outbox.deleteMany({ where: { text: { in: [text, question] } } })
    await db.$disconnect()
  }
})

test("mobile: long names, options and logins do not overflow any page", async ({
  page,
}) => {
  const db = new PrismaClient()
  const long =
    `E2E long ${Date.now()} ` + "Очень длинное название без пробелов ".repeat(4)
  const unbroken = "Z".repeat(120)
  const stamp = Date.now()
  const mgr = await db.manager.create({
    data: {
      login: `e2e-${unbroken}`.slice(0, 120),
      name: long,
      passwordHash: "x",
    },
  })
  const chat = await db.chat.create({
    data: { telegramId: BigInt(-stamp), title: long },
  })
  const tpl = await db.template.create({
    data: {
      name: long,
      kind: "poll",
      text: long,
      options: Array.from({ length: 10 }, (_, i) => `${i} ${long}`),
      authorId: mgr.id,
    },
  })
  const sch = await db.schedule.create({ data: { name: `${stamp} ${long}` } })
  const log = await db.sendLog.create({
    data: {
      chatId: chat.id,
      templateId: tpl.id,
      slot: new Date(),
      status: "sent",
      pollId: `p${stamp}`,
      text: long,
      options: tpl.options,
    },
  })
  // a voter and a silent member with long names and usernames on the answers page
  const voter = {
    firstName: long,
    lastName: unbroken,
    username: `u${"x".repeat(31)}`,
  }
  await db.pollAnswer.create({
    data: {
      pollId: `p${stamp}`,
      userId: BigInt(stamp),
      name: long,
      optionIds: [0],
      ...voter,
    },
  })
  await db.pollMember.createMany({
    data: [stamp, stamp + 1].map((id) => ({
      pollId: `p${stamp}`,
      userId: BigInt(id),
      ...voter,
    })),
  })
  try {
    await page.goto("/login")
    await page.getByLabel("Логин").fill(LOGIN)
    await page.getByLabel("Пароль").fill(PASSWORD)
    await page.getByRole("button", { name: "Войти" }).click()
    await page.waitForURL("**/chats")
    for (const path of [
      "/login",
      "/chats",
      `/chats/${chat.id}`,
      "/templates",
      "/schedules",
      "/logs",
      `/logs/${log.id}`,
      "/send",
      "/managers",
      "/profile",
      "/settings",
      "/system-logs",
    ]) {
      await page.goto(path)
      await page.addStyleTag({ content: "body{overflow-x:visible!important}" })
      await page.evaluate(() =>
        document.querySelectorAll("details").forEach((d) => (d.open = true))
      )
      await page.screenshot({
        path: `/tmp/shots-mobile2/${process.env.SHOT_DIR ?? "after"}-${path.replace(/\W+/g, "_")}.png`,
        fullPage: true,
      })
      const [scroll, inner] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        window.innerWidth,
      ])
      const wide = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((e) => e.getBoundingClientRect().right > window.innerWidth)
          .slice(-4)
          .map((e) => e.tagName + "." + e.className)
      )
      expect
        .soft(scroll, `${path} overflows: ${wide.join(" | ")}`)
        .toBeLessThanOrEqual(inner)
    }
  } finally {
    await db.sendLog.deleteMany({ where: { id: log.id } })
    await db.pollAnswer.deleteMany({ where: { pollId: `p${stamp}` } })
    await db.pollMember.deleteMany({ where: { pollId: `p${stamp}` } })
    await db.schedule.deleteMany({ where: { id: sch.id } })
    await db.template.deleteMany({ where: { id: tpl.id } })
    await db.chat.deleteMany({ where: { id: chat.id } })
    await db.manager.deleteMany({ where: { id: mgr.id } })
    await db.$disconnect()
  }
})

test("mobile: managers anchor, collapsed bound schedule, t.me link for supergroups", async ({
  page,
}) => {
  const db = new PrismaClient()
  const stamp = Date.now()
  const sch = await db.schedule.create({
    data: { name: `E2E anchor ${stamp}` },
  })
  const chat = await db.chat.create({
    data: {
      telegramId: BigInt(`-100${stamp}`),
      title: `E2E anchor ${stamp}`,
      scheduleId: sch.id,
    },
  })
  try {
    await page.goto("/login")
    await page.getByLabel("Логин").fill(LOGIN)
    await page.getByLabel("Пароль").fill(PASSWORD)
    await page.getByRole("button", { name: "Войти" }).click()
    await page.waitForURL("**/chats")
    await page.getByLabel(`Название чата -100${stamp}`).waitFor()
    await page
      .getByRole("link", { name: "Настроить менеджеров" })
      .first()
      .waitFor()
    await page.goto(`/chats/${chat.id}#managers`)
    await expect(page.locator("details#schedule")).not.toHaveAttribute("open")
    await expect(
      page.getByRole("link", { name: "Открыть в Telegram" })
    ).toHaveAttribute("href", `https://t.me/c/${stamp}`)
    const top = await page
      .locator("#managers")
      .evaluate((e) => e.getBoundingClientRect().top)
    expect(top).toBeGreaterThanOrEqual(0)
    await page.locator("details#schedule summary").click()
    await expect(page.locator("details#schedule")).toHaveAttribute("open", "")
  } finally {
    await db.chat.delete({ where: { id: chat.id } })
    await db.schedule.delete({ where: { id: sch.id } })
    await db.$disconnect()
  }
})
