-- Is the assigned manager an admin of the chat (#99)? Written by the bot from getChatMember; NULL checked_at =
-- check due (a new assignment, a new Telegram link). Nullable columns: a bot without this code ignores them.
ALTER TABLE "chat_managers" ADD COLUMN "member_status" TEXT,
ADD COLUMN "checked_at" TIMESTAMPTZ(3);
