-- What was actually sent, so the journal does not follow later template edits; NULL = sent before this column.
ALTER TABLE "send_logs" ADD COLUMN "text" TEXT,
ADD COLUMN "options" TEXT[] DEFAULT ARRAY[]::TEXT[];
