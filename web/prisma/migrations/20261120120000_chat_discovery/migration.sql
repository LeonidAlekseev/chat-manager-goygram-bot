-- CreateTable: one row (id = 1), «Найти группы бота» (#94). The panel queues a scan, the bot runs it and
-- writes the result; a bot without this code never reads the table.
CREATE TABLE "chat_discovery" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "found" INTEGER,
    "added" INTEGER,
    "error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_discovery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_discovery_single_row" CHECK ("id" = 1)
);
