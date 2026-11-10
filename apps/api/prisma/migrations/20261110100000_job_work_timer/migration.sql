ALTER TABLE "job_engagements"
  ADD COLUMN "work_accumulated_ms" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "work_segment_started_at" TIMESTAMP(3),
  ADD COLUMN "work_paused_at" TIMESTAMP(3),
  ADD COLUMN "work_ended_at" TIMESTAMP(3);

-- Preserve elapsed-time calculation for existing jobs in progress.
UPDATE "job_engagements"
SET "work_segment_started_at" = "work_started_at"
WHERE "status" = 'IN_PROGRESS'
  AND "work_started_at" IS NOT NULL
  AND "work_segment_started_at" IS NULL;
