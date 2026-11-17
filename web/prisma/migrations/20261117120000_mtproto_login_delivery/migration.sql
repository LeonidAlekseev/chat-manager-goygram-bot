-- AlterTable: where Telegram sent the login code (auth.sentCode, written by the bot) and whether it offers another way.
ALTER TABLE "mtproto_login" ADD COLUMN "sent" TEXT,
ADD COLUMN "resend" BOOLEAN NOT NULL DEFAULT false;
