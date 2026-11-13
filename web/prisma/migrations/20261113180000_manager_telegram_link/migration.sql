-- AlterTable
ALTER TABLE "managers" ADD COLUMN "telegram_user_id" BIGINT,
ADD COLUMN "link_code" TEXT,
ADD COLUMN "link_code_expires_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "managers_telegram_user_id_key" ON "managers"("telegram_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "managers_link_code_key" ON "managers"("link_code");
