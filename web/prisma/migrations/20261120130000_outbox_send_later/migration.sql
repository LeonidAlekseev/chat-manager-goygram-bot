-- Scheduled sends and custom polls from the panel (#97).
-- An old bot ignores these columns: it would send a scheduled job at once and a custom poll as plain text,
-- so stop the bot before this migration runs (see the PR / README deploy notes).
ALTER TABLE "outbox" ADD COLUMN "send_at" TIMESTAMP(3),
ADD COLUMN "options" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "anonymous" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "multiple" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "author_id" INTEGER;

-- AddForeignKey
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
