-- AlterTable: the panel asks the bot to leave and delete the chat; old bots ignore the column.
ALTER TABLE "chats" ADD COLUMN "deleting" BOOLEAN NOT NULL DEFAULT false;
