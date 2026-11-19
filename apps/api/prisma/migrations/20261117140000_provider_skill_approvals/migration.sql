CREATE TYPE "ProviderSkillStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "provider_skills" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "details" JSONB,
    "status" "ProviderSkillStatus" NOT NULL DEFAULT 'PENDING',
    "decision_reason" VARCHAR(1000),
    "reviewer_id" UUID,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "provider_skills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_skills_user_id_category_key" ON "provider_skills"("user_id", "category");
CREATE INDEX "provider_skills_status_submitted_at_idx" ON "provider_skills"("status", "submitted_at");
CREATE INDEX "provider_skills_user_id_status_idx" ON "provider_skills"("user_id", "status");

ALTER TABLE "provider_skills"
ADD CONSTRAINT "provider_skills_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
