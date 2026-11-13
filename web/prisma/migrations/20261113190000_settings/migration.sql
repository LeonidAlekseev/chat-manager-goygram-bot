-- CreateTable: one row (id = 1); secret columns hold AES-256-GCM ciphertext (see src/lib/crypto.ts).
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "bot_token" TEXT,
    "api_id" INTEGER,
    "api_hash" TEXT,
    "bot_username" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settings_single_row" CHECK ("id" = 1)
);
