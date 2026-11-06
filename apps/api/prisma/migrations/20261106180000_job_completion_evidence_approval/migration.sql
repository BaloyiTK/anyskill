CREATE TYPE "JobCompletionSubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "job_completion_submissions" (
  "id" UUID NOT NULL,
  "engagement_id" UUID NOT NULL,
  "provider_id" UUID NOT NULL,
  "notes" VARCHAR(3000) NOT NULL,
  "evidence_urls" TEXT[] NOT NULL,
  "status" "JobCompletionSubmissionStatus" NOT NULL DEFAULT 'PENDING',
  "review_note" VARCHAR(1000),
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3),
  CONSTRAINT "job_completion_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_completion_submissions_engagement_id_status_submitted_at_idx"
  ON "job_completion_submissions"("engagement_id", "status", "submitted_at");

ALTER TABLE "job_completion_submissions"
  ADD CONSTRAINT "job_completion_submissions_engagement_id_fkey"
  FOREIGN KEY ("engagement_id") REFERENCES "job_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
