-- AlterTable: «Отметить всех» for custom text sent from the panel; old bots ignore the column.
ALTER TABLE "outbox" ADD COLUMN "mention_all" BOOLEAN NOT NULL DEFAULT false;
