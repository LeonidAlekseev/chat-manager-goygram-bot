-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('pending', 'sent', 'error');

-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "schedule_id" INTEGER;

-- AlterTable
ALTER TABLE "schedule_items" ADD COLUMN     "start_date" DATE NOT NULL DEFAULT CURRENT_DATE;

-- CreateTable
CREATE TABLE "send_logs" (
    "id" SERIAL NOT NULL,
    "chat_id" INTEGER NOT NULL,
    "schedule_item_id" INTEGER,
    "template_id" INTEGER,
    "slot" TIMESTAMPTZ(3) NOT NULL,
    "status" "SendStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "message_id" BIGINT,
    "poll_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "send_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "send_logs_created_at_idx" ON "send_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "send_logs_chat_id_schedule_item_id_slot_key" ON "send_logs"("chat_id", "schedule_item_id", "slot");

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_logs" ADD CONSTRAINT "send_logs_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_logs" ADD CONSTRAINT "send_logs_schedule_item_id_fkey" FOREIGN KEY ("schedule_item_id") REFERENCES "schedule_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_logs" ADD CONSTRAINT "send_logs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

