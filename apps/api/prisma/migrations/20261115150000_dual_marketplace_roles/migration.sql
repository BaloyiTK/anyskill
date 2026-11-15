CREATE TYPE "MarketplaceRoleStatus" AS ENUM (
  'NOT_REQUESTED', 'PENDING', 'ACTIVE', 'REJECTED', 'REQUIRES_INFORMATION', 'SUSPENDED'
);
CREATE TYPE "ProviderApplicationStatus" AS ENUM (
  'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_INFORMATION'
);
CREATE TYPE "StaffRole" AS ENUM ('PROVIDER_REVIEWER', 'ADMIN', 'SUPER_ADMIN');

ALTER TABLE "users"
  ADD COLUMN "seeker_role_status" "MarketplaceRoleStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "provider_role_status" "MarketplaceRoleStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "active_marketplace_mode" "RegistrationMode" NOT NULL DEFAULT 'SEEKER';

-- Preserve roles already used by existing accounts.
UPDATE "users" u SET "seeker_role_status" = 'ACTIVE'
WHERE u."initial_mode" = 'SEEKER'
   OR EXISTS (SELECT 1 FROM "service_requests" sr WHERE sr."seeker_id" = u."id")
   OR EXISTS (SELECT 1 FROM "job_engagements" je WHERE je."seeker_id" = u."id");

UPDATE "users" u SET "provider_role_status" = 'ACTIVE'
WHERE u."initial_mode" = 'PROVIDER'
   OR EXISTS (SELECT 1 FROM "provider_profiles" pp WHERE pp."user_id" = u."id")
   OR EXISTS (SELECT 1 FROM "provider_responses" pr WHERE pr."provider_id" = u."id")
   OR EXISTS (SELECT 1 FROM "job_engagements" je WHERE je."provider_id" = u."id");

UPDATE "users" SET "active_marketplace_mode" = CASE
  WHEN "initial_mode" = 'PROVIDER' AND "provider_role_status" = 'ACTIVE' THEN 'PROVIDER'::"RegistrationMode"
  ELSE 'SEEKER'::"RegistrationMode"
END;

CREATE TABLE "provider_role_applications" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "ProviderApplicationStatus" NOT NULL DEFAULT 'PENDING',
  "application_data" JSONB NOT NULL,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3),
  "reviewer_id" UUID,
  "decision_reason" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_role_applications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "provider_role_applications_user_id_key" ON "provider_role_applications"("user_id");
CREATE INDEX "provider_role_applications_status_submitted_at_idx" ON "provider_role_applications"("status", "submitted_at");
CREATE INDEX "provider_role_applications_reviewer_id_reviewed_at_idx" ON "provider_role_applications"("reviewer_id", "reviewed_at");

CREATE TABLE "staff_memberships" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "StaffRole" NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staff_memberships_user_id_key" ON "staff_memberships"("user_id");
CREATE INDEX "staff_memberships_role_is_active_idx" ON "staff_memberships"("role", "is_active");

CREATE TABLE "staff_audit_logs" (
  "id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "target_user_id" UUID NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staff_audit_logs_target_user_id_created_at_idx" ON "staff_audit_logs"("target_user_id", "created_at");
CREATE INDEX "staff_audit_logs_actor_id_created_at_idx" ON "staff_audit_logs"("actor_id", "created_at");

ALTER TABLE "provider_role_applications"
  ADD CONSTRAINT "provider_role_applications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "provider_role_applications_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "staff_memberships"
  ADD CONSTRAINT "staff_memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_audit_logs"
  ADD CONSTRAINT "staff_audit_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_audit_logs_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
