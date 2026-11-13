import { execSync } from "node:child_process"

export default function setup() {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error("TEST_DATABASE_URL is required")
  execSync("prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  })
}
