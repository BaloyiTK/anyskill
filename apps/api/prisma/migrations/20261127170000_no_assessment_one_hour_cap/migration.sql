ALTER TABLE "provider_responses"
  ADD COLUMN "assessment_required_at_offer" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "job_engagements"
  ADD COLUMN "assessment_required" BOOLEAN NOT NULL DEFAULT TRUE;
