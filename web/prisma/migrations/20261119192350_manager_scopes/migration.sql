-- AlterTable
ALTER TABLE "schedules" ADD COLUMN     "author_id" INTEGER;

-- CreateTable
CREATE TABLE "chat_managers" (
    "chat_id" INTEGER NOT NULL,
    "manager_id" INTEGER NOT NULL,

    CONSTRAINT "chat_managers_pkey" PRIMARY KEY ("chat_id","manager_id")
);

-- CreateIndex
CREATE INDEX "chat_managers_manager_id_idx" ON "chat_managers"("manager_id");

-- AddForeignKey
ALTER TABLE "chat_managers" ADD CONSTRAINT "chat_managers_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_managers" ADD CONSTRAINT "chat_managers_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "managers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing schedules are the superadmin's (NULL counts as the superadmin's too, e.g. on a DB with no superadmin yet).
UPDATE "schedules" SET "author_id" = (SELECT "id" FROM "managers" WHERE "role" = 'superadmin' ORDER BY "id" LIMIT 1);
