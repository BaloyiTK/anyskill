-- Retain marketplace requests and job history when an account is permanently deleted.
-- User references become nullable so historical rows can survive without a user record.

ALTER TABLE "service_requests"
  ALTER COLUMN "seeker_id" DROP NOT NULL;

ALTER TABLE "service_requests"
  DROP CONSTRAINT IF EXISTS "service_requests_seeker_id_fkey",
  ADD CONSTRAINT "service_requests_seeker_id_fkey"
    FOREIGN KEY ("seeker_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provider_responses"
  ALTER COLUMN "provider_id" DROP NOT NULL;

ALTER TABLE "provider_responses"
  DROP CONSTRAINT IF EXISTS "provider_responses_provider_id_fkey",
  ADD CONSTRAINT "provider_responses_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "request_matches"
  ALTER COLUMN "provider_id" DROP NOT NULL;

ALTER TABLE "job_engagements"
  ALTER COLUMN "seeker_id" DROP NOT NULL,
  ALTER COLUMN "provider_id" DROP NOT NULL;

ALTER TABLE "job_completion_submissions"
  ALTER COLUMN "provider_id" DROP NOT NULL;
