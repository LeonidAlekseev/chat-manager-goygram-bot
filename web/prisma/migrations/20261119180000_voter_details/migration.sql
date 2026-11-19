-- AlterTable: the voter's and member's Telegram names and username, kept apart; nullable, so a running bot
-- that does not write them yet keeps working and old rows keep only `name` / the id.
ALTER TABLE "poll_answers" ADD COLUMN "first_name" TEXT,
ADD COLUMN "last_name" TEXT,
ADD COLUMN "username" TEXT;

ALTER TABLE "poll_members" ADD COLUMN "first_name" TEXT,
ADD COLUMN "last_name" TEXT,
ADD COLUMN "username" TEXT;
