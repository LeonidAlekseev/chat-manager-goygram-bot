-- AlterEnum
ALTER TYPE "TemplateKind" ADD VALUE 'copy';

-- AlterTable
ALTER TABLE "templates" ADD COLUMN "source_chat_id" BIGINT,
ADD COLUMN "source_message_id" BIGINT,
ADD COLUMN "media_type" TEXT,
ADD COLUMN "author_id" INTEGER;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
