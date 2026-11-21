ALTER TYPE "MediaAssetStatus" ADD VALUE IF NOT EXISTS 'VERIFYING';

ALTER TABLE "media_assets"
  ADD COLUMN "verification_started_at" TIMESTAMP(3);

CREATE INDEX "media_assets_status_verification_started_at_idx"
  ON "media_assets" ("status", "verification_started_at");
