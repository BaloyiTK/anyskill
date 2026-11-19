CREATE TABLE "seeker_reviews" (
    "id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "seeker_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(1500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seeker_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seeker_reviews_engagement_id_key" ON "seeker_reviews"("engagement_id");
CREATE INDEX "seeker_reviews_seeker_id_created_at_idx" ON "seeker_reviews"("seeker_id", "created_at");
CREATE INDEX "seeker_reviews_provider_id_created_at_idx" ON "seeker_reviews"("provider_id", "created_at");

ALTER TABLE "seeker_reviews"
ADD CONSTRAINT "seeker_reviews_engagement_id_fkey"
FOREIGN KEY ("engagement_id") REFERENCES "job_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "seeker_reviews"
ADD CONSTRAINT "seeker_reviews_provider_id_fkey"
FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "seeker_reviews"
ADD CONSTRAINT "seeker_reviews_seeker_id_fkey"
FOREIGN KEY ("seeker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
