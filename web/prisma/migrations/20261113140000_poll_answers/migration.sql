-- CreateTable
CREATE TABLE "poll_answers" (
    "poll_id" TEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "option_ids" INTEGER[],
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_answers_pkey" PRIMARY KEY ("poll_id","user_id")
);
