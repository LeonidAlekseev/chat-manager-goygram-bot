import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { demux, loadSystemLogs, mask } from "@/lib/systemLogs"

const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("@/auth", () => ({ auth: async () => session.current }))

const asRole = (role: string | null) =>
  (session.current = role && { user: { name: "u", role } })

// Docker's multiplexed log stream: [stream, 0, 0, 0, size BE u32] + payload
function frame(stream: number, text: string) {
  const payload = Buffer.from(text)
  const head = Buffer.alloc(8)
  head[0] = stream
  head.writeUInt32BE(payload.length, 4)
  return Buffer.concat([head, payload])
}

describe("demux", () => {
  it("joins stdout and stderr frames, even a UTF-8 char split across frames", () => {
    const ru = Buffer.from("ошибка\n")
    const split = Buffer.concat([
      frame(1, "ok\n"),
      Buffer.from([2, 0, 0, 0, 0, 0, 0, 3]),
      ru.subarray(0, 3),
      Buffer.from([2, 0, 0, 0, 0, 0, 0, ru.length - 3]),
      ru.subarray(3),
    ])
    expect(demux(split)).toBe("ok\nошибка\n")
  })

  it("passes a TTY container's raw stream through", () => {
    expect(demux(Buffer.from("plain line\n"))).toBe("plain line\n")
  })
})

describe("mask", () => {
  it.each([
    ["token 1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0 ok", "token *** ok"],
    [
      "postgresql://chat:s3cr3tPass@db:5432/chat",
      "postgresql://chat:***@db:5432/chat",
    ],
    ["redis://u:ab/c+d=@cache:6379", "redis://u:***@cache:6379"],
    ["phone +7 999 123-45-67 sent", "phone *** sent"],
    ["phone 79991234567 sent", "phone *** sent"],
    ['{"api_hash": "0123456789abcdef"}', '{"api_hash": "***"}'],
    ["AUTH_SECRET=abc/def+ghi=", "AUTH_SECRET=***"],
  ])("%s", (raw, masked) => expect(mask(raw)).toBe(masked))

  it("masks the panel's own secret values wherever they appear", () => {
    expect(mask("got Zm9vYmFyYmF6cXV4 back", ["Zm9vYmFyYmF6cXV4"])).toBe(
      "got *** back"
    )
  })

  it("keeps timestamps, chat ids and user ids readable", () => {
    const line =
      "2026-11-18T10:00:00.123456789Z chat -1001234567890 user 123456789"
    expect(mask(line)).toBe(line)
  })
})

describe("loadSystemLogs", () => {
  const calls: string[] = []
  const containers = [
    {
      Id: "aaa",
      Names: ["/p-web-1"],
      State: "running",
      Labels: {
        "com.docker.compose.project": "p",
        "com.docker.compose.service": "web",
      },
    },
    {
      Id: "bbb",
      Names: ["/p-bot-1"],
      State: "running",
      Labels: {
        "com.docker.compose.project": "p",
        "com.docker.compose.service": "bot",
      },
    },
    // a foreign container the proxy might return if the filter were ignored
    {
      Id: "zzz",
      Names: ["/other-app-1"],
      State: "running",
      Labels: {
        "com.docker.compose.project": "other",
        "com.docker.compose.service": "bot",
      },
    },
  ]

  beforeEach(() => {
    calls.length = 0
    vi.stubEnv("DOCKER_PROXY_URL", "http://proxy:2375")
    vi.stubEnv("COMPOSE_PROJECT", "p")
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url)
      if (url.includes("/containers/json")) return Response.json(containers)
      return new Response(
        Buffer.concat([
          frame(1, "2026 started\n"),
          frame(
            2,
            "2026 ERROR token 1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0\n"
          ),
          frame(1, "2026 Warning: slow\n"),
        ])
      )
    })
    asRole("superadmin")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it.each([["manager"], [null]])("refuses %s", async (role) => {
    asRole(role)
    await expect(loadSystemLogs({})).rejects.toThrow("Forbidden")
    expect(calls).toEqual([])
  })

  it("lists only this compose project, filtered at the proxy and again here", async () => {
    const res = await loadSystemLogs({})
    expect(res.containers.map((c) => c.name)).toEqual(["bot", "web"])
    const filters = new URL(calls[0]).searchParams.get("filters")
    expect(JSON.parse(filters!)).toEqual({
      label: ["com.docker.compose.project=p"],
    })
  })

  it("reads the chosen service's logs, masked, with errors-only and search", async () => {
    const res = await loadSystemLogs({ container: "web", tail: "500" })
    expect(calls[1]).toBe(
      "http://proxy:2375/containers/aaa/logs?stdout=1&stderr=1&timestamps=1&tail=500"
    )
    expect(res.lines).toEqual([
      "2026 started",
      "2026 ERROR token ***",
      "2026 Warning: slow",
    ])
    const errs = await loadSystemLogs({ container: "web", errors: "1" })
    expect(errs.lines).toEqual(["2026 ERROR token ***", "2026 Warning: slow"])
    const found = await loadSystemLogs({ container: "web", q: "SLOW" })
    expect(found.lines).toEqual(["2026 Warning: slow"])
    // searching for a secret must not reveal that it was there
    const secret = await loadSystemLogs({ container: "web", q: "AAHdq" })
    expect(secret.lines).toEqual([])
  })

  it("never reads a container outside the project, and clamps tail", async () => {
    const res = await loadSystemLogs({ container: "zzz", tail: "100000" })
    expect(res.current).toBe("bot")
    expect(calls[1]).toContain("/containers/bbb/logs")
    expect(calls[1]).toContain("tail=200")
  })

  it("explains when the proxy is not configured", async () => {
    vi.stubEnv("DOCKER_PROXY_URL", "")
    const res = await loadSystemLogs({})
    expect(res.error).toBeTruthy()
    expect(calls).toEqual([])
  })
})
