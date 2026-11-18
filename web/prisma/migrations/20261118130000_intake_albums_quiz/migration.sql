-- AlterTable
ALTER TABLE "templates" ADD COLUMN "correct_option_id" INTEGER,
ADD COLUMN "explanation" TEXT,
ADD COLUMN "media_group_id" TEXT,
ADD COLUMN "source_message_ids" BIGINT[] DEFAULT ARRAY[]::BIGINT[];

-- Existing copy templates keep their single source message.
UPDATE "templates" SET "source_message_ids" = ARRAY["source_message_id"] WHERE "source_message_id" IS NOT NULL;

ALTER TABLE "templates" DROP COLUMN "source_message_id";

-- CreateIndex
CREATE UNIQUE INDEX "templates_source_chat_id_media_group_id_key" ON "templates"("source_chat_id", "media_group_id");
