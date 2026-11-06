CREATE TABLE "onboarding_drafts" (
 "id" UUID NOT NULL,
 "user_id" UUID NOT NULL,
 "profile" JSONB,
 "skills" JSONB,
 "portfolio" JSONB,
 "submitted_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "onboarding_drafts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "onboarding_drafts_user_id_key" ON "onboarding_drafts"("user_id");
ALTER TABLE "onboarding_drafts" ADD CONSTRAINT "onboarding_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
