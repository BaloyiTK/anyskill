CREATE TABLE "provider_reviews" (
  "id" UUID NOT NULL,
  "engagement_id" UUID NOT NULL,
  "seeker_id" UUID NOT NULL,
  "provider_id" UUID NOT NULL,
  "skill_category" VARCHAR(100) NOT NULL,
  "skill_rating" INTEGER NOT NULL,
  "platform_rating" INTEGER NOT NULL,
  "comment" VARCHAR(1500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "provider_reviews_engagement_id_key" ON "provider_reviews"("engagement_id");
CREATE INDEX "provider_reviews_provider_id_skill_category_created_at_idx" ON "provider_reviews"("provider_id", "skill_category", "created_at");
CREATE INDEX "provider_reviews_provider_id_created_at_idx" ON "provider_reviews"("provider_id", "created_at");
ALTER TABLE "provider_reviews" ADD CONSTRAINT "provider_reviews_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "job_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_reviews" ADD CONSTRAINT "provider_reviews_seeker_id_fkey" FOREIGN KEY ("seeker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_reviews" ADD CONSTRAINT "provider_reviews_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_reviews" ADD CONSTRAINT "provider_reviews_skill_rating_check" CHECK ("skill_rating" BETWEEN 1 AND 5);
ALTER TABLE "provider_reviews" ADD CONSTRAINT "provider_reviews_platform_rating_check" CHECK ("platform_rating" BETWEEN 1 AND 5);
