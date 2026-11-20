import { expect, test } from "@playwright/test"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

import type { Locator } from "@playwright/test"

import { LOGIN, PASSWORD } from "../playwright.config"
import { CHAT } from "./global-setup"

test.use({ viewport: { width: 390, height: 844 } })

test("mobile: no horizontal overflow, chat title visible, light /v2 theme only, TaskManager", async ({
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
  ).toBe("rgb(244, 248, 247)") // the /v2 mint-grey page background (#112), also under a dark system theme
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
    const row = page.getByRole("listitem").filter({
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

test("mobile: bottom bar sections in order, the account menu holds Профиль and admin pages", async ({
  page,
}) => {
  await page.goto("/login")
  await page.getByLabel("Логин").fill(LOGIN)
  await page.getByLabel("Пароль").fill(PASSWORD)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")
  const profile = page.getByRole("button", { name: "Пользователь" })
  await expect(profile.locator("svg")).toBeVisible()
  const bar = page.getByRole("navigation", { name: "Разделы" }).last()
  await expect(bar).toBeVisible()
  await expect(bar.getByRole("link")).toHaveText([
    "Чаты",
    "Шаблоны",
    "Расписания",
    "Отправка",
    "Журнал",
  ])
  await expect(bar.getByRole("link", { name: "Чаты" })).toHaveAttribute(
    "aria-current",
    "page"
  )
  await bar.getByRole("link", { name: "Расписания" }).click()
  await page.waitForURL("**/schedules")
  await expect(
    page.getByRole("heading", { level: 1, name: "Расписания" })
  ).toBeVisible()

  await profile.click()
  const menu = page.getByRole("menu")
  await expect(menu.getByRole("menuitem", { name: "Профиль" })).toHaveAttribute(
    "href",
    "/profile"
  )
  for (const name of ["Менеджеры", "Настройки", "Системные логи", "Выйти"])
    await expect(menu.getByRole("menuitem", { name })).toBeVisible()
  await page.screenshot({ path: "/tmp/shots-adopt-v2/menu.png" })
  await menu.getByRole("menuitem", { name: "Настройки" }).click()
  await page.waitForURL("**/settings")
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

test("mobile: the frosted header and the bottom bar stay on screen while scrolling, content clears the bar", async ({
  page,
}) => {
  await page.goto("/login")
  await page.getByLabel("Логин").fill(LOGIN)
  await page.getByLabel("Пароль").fill(PASSWORD)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL("**/chats")

  const header = page.locator("header")
  const bar = page.getByRole("navigation", { name: "Разделы" }).last()
  await page.evaluate(() => (document.body.style.minHeight = "3000px"))
  await page.evaluate(() => window.scrollTo(0, 600))
  await expect(
    page.getByRole("button", { name: "Пользователь" })
  ).toBeInViewport()
  const box = async (l: Locator) => (await l.boundingBox())!
  expect((await box(header)).y).toBe(0)
  const b = await box(bar)
  expect(b.y + b.height).toBeCloseTo(844, 0)
  // matte: translucent white with a blur behind it
  const style = await header.evaluate((el) => {
    const s = getComputedStyle(el)
    return [s.backdropFilter, s.backgroundColor]
  })
  expect(style[0]).toContain("blur")
  expect(style[1]).toMatch(/^(rgba|oklab|color)\(/)
  // the end of the page is not hidden behind the bar
  const pad = await page
    .locator("main")
    .evaluate((m) => parseFloat(getComputedStyle(m).paddingBottom))
  expect(pad).toBeGreaterThanOrEqual(b.height)
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
  const filler = `E2E filler ${Date.now()}`
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
    // 50 newer jobs push it past the "recent" limit: a scheduled one is still listed
    await db.outbox.createMany({
      data: Array.from({ length: 50 }, () => ({
        chatId: poll.chatId,
        text: filler,
      })),
    })

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
    await db.outbox.deleteMany({
      where: { text: { in: [text, question, filler] } },
    })
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

test("mobile: managers anchor, collapsed bound schedule, t.me link only for a public group", async ({
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
      username: `e2e_anchor_${stamp}`,
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
      .getByRole("link", { name: /^Настроить менеджеров/ })
      .first()
      .waitFor()
    await expect(
      page.getByRole("link", { name: /^Настроить расписание/ }).first()
    ).toBeVisible()
    await page.goto(`/chats/${chat.id}#managers`)
    await expect(page.locator("details#schedule")).not.toHaveAttribute("open")
    await expect(
      page.getByRole("link", { name: "Открыть в Telegram" })
    ).toHaveAttribute("href", `https://t.me/e2e_anchor_${stamp}`)
    // a private group (no @username): no link and no «no link» caption, on the card or the page
    await db.chat.update({ where: { id: chat.id }, data: { username: null } })
    await page.reload()
    await expect(
      page.getByRole("link", { name: "Открыть в Telegram" })
    ).toHaveCount(0)
    await page.goto("/chats")
    await expect(
      page.getByRole("link", { name: "Открыть в Telegram" })
    ).toHaveCount(0)
    await expect(page.getByText("Ссылки нет")).toHaveCount(0)
    await page.goto(`/chats/${chat.id}#managers`)
    const top = await page
      .locator("#managers")
      .evaluate((e) => e.getBoundingClientRect().top)
    // not under the sticky header (scroll-padding-top on <html>)
    const header = await page
      .locator("header")
      .evaluate((e) => e.getBoundingClientRect().bottom)
    expect(top).toBeGreaterThanOrEqual(header)
    await page.locator("details#schedule summary").click()
    await expect(page.locator("details#schedule")).toHaveAttribute("open", "")
  } finally {
    await db.chat.delete({ where: { id: chat.id } })
    await db.schedule.delete({ where: { id: sch.id } })
    await db.$disconnect()
  }
})

test("mobile: a manager's «not in the chat» badge fits the screen (#121)", async ({
  page,
}) => {
  const db = new PrismaClient()
  const stamp = Date.now()
  const title = `E2E бейдж ${stamp} ` + "Длинное название чата ".repeat(4)
  const mgr = await db.manager.create({
    data: {
      login: `e2e-badge-${stamp}`,
      passwordHash: await bcrypt.hash("pw-badge-test", 4),
      telegramUserId: BigInt(stamp),
    },
  })
  const chat = await db.chat.create({
    data: {
      telegramId: BigInt(-stamp),
      title,
      managers: { create: { managerId: mgr.id, memberStatus: "absent" } },
    },
  })
  try {
    await page.goto("/login")
    await page.getByLabel("Логин").fill(mgr.login)
    await page.getByLabel("Пароль").fill("pw-badge-test")
    await page.getByRole("button", { name: "Войти" }).click()
    await page.waitForURL("**/chats")
    for (const path of ["/chats", `/chats/${chat.id}`]) {
      await page.goto(path)
      await expect(page.getByText("Вас нет в чате")).toBeVisible()
      await expect(
        page.getByText(/\/all работает для администраторов/)
      ).toBeVisible()
      await page.addStyleTag({ content: "body{overflow-x:visible!important}" })
      const [scroll, inner] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        window.innerWidth,
      ])
      expect(scroll, `${path} overflows`).toBeLessThanOrEqual(inner)
    }
  } finally {
    await db.chat.deleteMany({ where: { id: chat.id } })
    await db.manager.deleteMany({ where: { id: mgr.id } })
    await db.$disconnect()
  }
})
