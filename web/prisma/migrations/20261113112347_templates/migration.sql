-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('poll', 'text');

-- CreateTable
CREATE TABLE "templates" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "text" TEXT NOT NULL,
    "options" TEXT[],
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "multiple" BOOLEAN NOT NULL DEFAULT false,
    "mention_all" BOOLEAN NOT NULL DEFAULT false,
    "legacy_mid" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_items" (
    "id" SERIAL NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "template_id" INTEGER NOT NULL,
    "time" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'day',

    CONSTRAINT "schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "templates_legacy_mid_key" ON "templates"("legacy_mid");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_name_key" ON "schedules"("name");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_items_schedule_id_template_id_time_key" ON "schedule_items"("schedule_id", "template_id", "time");

-- AddForeignKey
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
