import { defineConfig } from "@playwright/test"

// One smoke test against the built panel (`pnpm build` first). DATABASE_URL: a disposable or dev DB —
// the test adds a chat and uniquely named template/schedule rows. With SUPERADMIN_* unset, an e2e superadmin is created.
export const LOGIN = process.env.SUPERADMIN_LOGIN || "e2e-admin"
export const PASSWORD = process.env.SUPERADMIN_PASSWORD || "e2e-password"
const PORT = 3100

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts", // keeps it out of vitest
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: `pnpm exec prisma migrate deploy && pnpm start -p ${PORT}`, // fresh DB: the server creates the superadmin on start,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    env: {
      AUTH_SECRET:
        process.env.AUTH_SECRET || "e2e-only-secret-not-for-production",
      SUPERADMIN_LOGIN: LOGIN,
      SUPERADMIN_PASSWORD: PASSWORD,
    },
  },
})
