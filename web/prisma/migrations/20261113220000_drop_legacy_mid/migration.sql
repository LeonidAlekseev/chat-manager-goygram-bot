-- Dead since the old-bot import script was removed: nothing reads or writes it.
DROP INDEX "templates_legacy_mid_key";
ALTER TABLE "templates" DROP COLUMN "legacy_mid";
