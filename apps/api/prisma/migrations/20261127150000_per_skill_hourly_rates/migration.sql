ALTER TABLE "provider_skills"
ADD COLUMN "hourly_rate" DECIMAL(10,2);

-- Preserve each existing Provider's configured hourly rate for every existing skill.
UPDATE "provider_skills" AS skill
SET "hourly_rate" = profile."hourly_rate"
FROM "provider_profiles" AS profile
WHERE profile."user_id" = skill."user_id"
  AND skill."hourly_rate" IS NULL
  AND profile."hourly_rate" IS NOT NULL;
