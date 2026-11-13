export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSuperadmin } = await import("@/lib/credentials")
    await ensureSuperadmin()
  }
}
