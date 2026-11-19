-- Deleting a manager is refused while they author templates: their rows must not turn into the superadmin's (author NULL).
ALTER TABLE "templates" DROP CONSTRAINT "templates_author_id_fkey";
ALTER TABLE "templates" ADD CONSTRAINT "templates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "managers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
