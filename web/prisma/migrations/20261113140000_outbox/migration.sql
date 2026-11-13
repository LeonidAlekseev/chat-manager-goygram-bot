-- AlterTable
ALTER TABLE "send_logs" ADD COLUMN     "outbox_id" INTEGER;

-- CreateTable
CREATE TABLE "outbox" (
    "id" SERIAL NOT NULL,
    "chat_id" INTEGER NOT NULL,
    "template_id" INTEGER,
    "text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "send_logs_outbox_id_key" ON "send_logs"("outbox_id");

-- AddForeignKey
ALTER TABLE "send_logs" ADD CONSTRAINT "send_logs_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "outbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
