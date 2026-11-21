ALTER TABLE "provider_profiles"
  ADD COLUMN "public_name" VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN "hourly_rate" DECIMAL(10,2),
  ADD COLUMN "assessment_fee" DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "provider_responses"
  ADD COLUMN "hourly_rate_at_offer" DECIMAL(10,2),
  ADD COLUMN "assessment_fee_at_offer" DECIMAL(10,2);
