ALTER TABLE "job_completion_submissions"
  ADD COLUMN "idempotency_key" VARCHAR(100),
  ADD COLUMN "idempotency_payload_hash" CHAR(64);

CREATE UNIQUE INDEX "job_completion_submissions_engagement_idempotency_key_key"
  ON "job_completion_submissions" ("engagement_id", "idempotency_key");
