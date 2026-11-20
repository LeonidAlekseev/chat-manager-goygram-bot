-- Chat photos (#113): the bot downloads each group's small photo; NULL photo_checked_at = check due.
-- A new nullable column and a new table: a running bot without this code ignores both.
-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "photo_checked_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "chat_photos" (
    "chat_id" INTEGER NOT NULL,
    "unique_id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_photos_pkey" PRIMARY KEY ("chat_id")
);

-- AddForeignKey
ALTER TABLE "chat_photos" ADD CONSTRAINT "chat_photos_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

