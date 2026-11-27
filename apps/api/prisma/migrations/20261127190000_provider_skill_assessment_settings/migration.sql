ALTER TABLE "provider_skills"
  ADD COLUMN "assessment_required" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "assessment_fee" DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- Preserve the previous Provider-wide configuration when moving to per-skill
-- settings: every existing skill inherits the saved profile values once.
UPDATE "provider_skills" AS skill
SET
  "assessment_required" = profile."assessment_required",
  "assessment_fee" = profile."assessment_fee"
FROM "provider_profiles" AS profile
WHERE skill."user_id" = profile."user_id";
