-- Public @username of a group (#116), saved by the bot from getChat; NULL = no public link.
-- A new nullable column: a running bot without this code ignores it.
-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "username" TEXT;
