ALTER TABLE "job_engagements"
  ADD COLUMN "assessment_draft_hours" DECIMAL(8,2),
  ADD COLUMN "assessment_draft_notes" VARCHAR(2000),
  ADD COLUMN "assessment_draft_updated_at" TIMESTAMP(3);
