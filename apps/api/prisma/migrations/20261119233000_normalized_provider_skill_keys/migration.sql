ALTER TABLE "provider_profiles"
  ADD COLUMN "normalized_skill_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "provider_profiles" AS profile
SET "normalized_skill_keys" = COALESCE(
  (
    SELECT ARRAY_AGG(DISTINCT normalized.skill_key ORDER BY normalized.skill_key)
    FROM (
      SELECT regexp_replace(lower(btrim(category.value)), '[^[:alnum:]]', '', 'g') AS skill_key
      FROM unnest(profile."skill_categories") AS category(value)
    ) AS normalized
    WHERE normalized.skill_key <> ''
  ),
  ARRAY[]::TEXT[]
);

CREATE INDEX "provider_profiles_normalized_skill_keys_gin_idx"
  ON "provider_profiles" USING GIN ("normalized_skill_keys");
