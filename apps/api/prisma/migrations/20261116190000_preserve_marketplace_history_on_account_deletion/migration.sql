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

-- Permanently purge legacy soft-deleted accounts using the same retention policy.
-- Keep marketplace/job rows, detach user references, and scrub free-text/location data.
UPDATE "service_requests" sr
SET "seeker_id" = NULL,
    "title" = 'Request retained after account deletion',
    "description" = 'Request details removed following account deletion.',
    "location" = NULL,
    "latitude" = NULL,
    "longitude" = NULL,
    "instructions" = NULL,
    "image_urls" = ARRAY[]::TEXT[]
FROM "users" u
WHERE sr."seeker_id" = u."id" AND u."deleted_at" IS NOT NULL;

UPDATE "provider_responses" pr
SET "provider_id" = NULL, "message" = NULL
FROM "users" u
WHERE pr."provider_id" = u."id" AND u."deleted_at" IS NOT NULL;

UPDATE "request_matches" rm
SET "provider_id" = NULL
FROM "users" u
WHERE rm."provider_id" = u."id" AND u."deleted_at" IS NOT NULL;

UPDATE "job_engagements" je
SET "seeker_id" = NULL,
    "provider_id" = NULL,
    "estimate_notes" = NULL,
    "estimate_decision_note" = NULL
FROM "users" u
WHERE (je."seeker_id" = u."id" OR je."provider_id" = u."id")
  AND u."deleted_at" IS NOT NULL;

UPDATE "job_cost_adjustments" jca
SET "reason" = 'Adjustment details removed following account deletion.',
    "decision_note" = NULL
FROM "job_engagements" je, "users" u
WHERE jca."engagement_id" = je."id"
  AND (je."seeker_id" = u."id" OR je."provider_id" = u."id")
  AND u."deleted_at" IS NOT NULL;

UPDATE "job_completion_submissions" jcs
SET "provider_id" = NULL,
    "notes" = 'Completion details removed following account deletion.',
    "evidence_urls" = ARRAY[]::TEXT[],
    "review_note" = NULL
FROM "users" u
WHERE jcs."provider_id" = u."id" AND u."deleted_at" IS NOT NULL;

DELETE FROM "staff_audit_logs" sal
USING "users" u
WHERE (sal."actor_id" = u."id" OR sal."target_user_id" = u."id")
  AND u."deleted_at" IS NOT NULL;

DELETE FROM "users" WHERE "deleted_at" IS NOT NULL;
