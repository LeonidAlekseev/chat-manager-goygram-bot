-- AlterTable: rows older than a year are purged by the bot (retention).
ALTER TABLE "poll_members" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
