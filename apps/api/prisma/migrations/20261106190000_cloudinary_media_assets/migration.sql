CREATE TYPE "MediaAssetStatus" AS ENUM ('PENDING', 'READY', 'EXPIRED');
CREATE TABLE "media_assets" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "object_key" VARCHAR(512) NOT NULL,
  "original_name" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(100) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "purpose" VARCHAR(50) NOT NULL,
  "status" "MediaAssetStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "uploaded_at" TIMESTAMP(3),
  "completion_submission_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "media_assets_object_key_key" ON "media_assets"("object_key");
CREATE INDEX "media_assets_user_id_status_expires_at_idx" ON "media_assets"("user_id","status","expires_at");
CREATE INDEX "media_assets_completion_submission_id_idx" ON "media_assets"("completion_submission_id");
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_completion_submission_id_fkey" FOREIGN KEY ("completion_submission_id") REFERENCES "job_completion_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;