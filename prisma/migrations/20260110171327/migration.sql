-- CreateTable
CREATE TABLE "Summary" (
    "id" UUID NOT NULL,
    "lecture_id" UUID NOT NULL,
    "summary_text" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Summary_pkey" PRIMARY KEY ("id")
);
