ALTER TABLE "provider_profiles"
  ADD COLUMN "assessment_required" BOOLEAN NOT NULL DEFAULT TRUE;

-- Pending offers now inherit the Provider's saved profile settings, not choices
-- supplied while accepting an individual request.
UPDATE "provider_responses" AS response
SET
  "assessment_required_at_offer" = profile."assessment_required",
  "assessment_fee_at_offer" = profile."assessment_fee"
FROM "provider_profiles" AS profile, "service_requests" AS request
WHERE response."provider_id" = profile."user_id"
  AND response."request_id" = request."id"
  AND response."status" = 'OFFERED'
  AND request."status" = 'OPEN';

-- Repair only pending records that were incorrectly marked no-assessment.
-- The one-hour no-assessment path is preserved by its one-hour estimate and
-- final approval snapshot, which this update deliberately excludes.
UPDATE "job_engagements" AS engagement
SET
  "assessment_required" = profile."assessment_required",
  "assessment_fee" = profile."assessment_fee"
FROM "provider_profiles" AS profile
WHERE engagement."provider_id" = profile."user_id"
  AND engagement."status" = 'ASSESSMENT_PENDING'
  AND engagement."assessment_required" = FALSE
  AND profile."assessment_required" = TRUE
  AND engagement."assessment_started_at" IS NULL
  AND engagement."estimated_hours" IS NULL
  AND engagement."final_approved_at" IS NULL;
