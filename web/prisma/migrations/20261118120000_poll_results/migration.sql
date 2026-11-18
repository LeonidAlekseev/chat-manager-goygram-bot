-- CreateTable: a poll's anonymity and vote counts, written by the bot from `poll` updates.
CREATE TABLE "poll_results" (
    "poll_id" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL,
    "counts" INTEGER[],
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_results_pkey" PRIMARY KEY ("poll_id")
);
