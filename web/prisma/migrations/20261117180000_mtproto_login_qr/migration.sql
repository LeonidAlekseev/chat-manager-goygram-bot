-- AlterTable: the tg://login link of the current QR code, written by the bot for the panel to draw.
ALTER TABLE "mtproto_login" ADD COLUMN "qr" TEXT;
