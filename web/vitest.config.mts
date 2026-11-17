import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // tsconfig says "jsx": "preserve" (Next), so tests need JSX compiled here.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    globalSetup: "./tests/global-setup.ts",
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      AUTH_SECRET: "vitest-only-secret",
    },
    fileParallelism: false,
  },
})
