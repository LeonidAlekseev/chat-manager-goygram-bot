-- AlterTable: the MTProto account session (AES-256-GCM, see src/lib/crypto.ts) and bot status, written by the bot.
ALTER TABLE "settings" ADD COLUMN "api_session" TEXT,
ADD COLUMN "api_account" TEXT,
ADD COLUMN "bot_seen_at" TIMESTAMP(3),
ADD COLUMN "bot_error" TEXT;

-- CreateTable: one row (id = 1), the login wizard. The panel writes a step and its encrypted input;
-- the bot clears both when it takes the step, then reports what it waits for next (state) or an error.
CREATE TABLE "mtproto_login" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "step" TEXT,
    "input" TEXT,
    "state" TEXT,
    "error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mtproto_login_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mtproto_login_single_row" CHECK ("id" = 1)
);
