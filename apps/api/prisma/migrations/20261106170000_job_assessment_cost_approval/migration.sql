CREATE TYPE "JobEngagementStatus" AS ENUM (
  'ASSESSMENT_PENDING',
  'ESTIMATE_SUBMITTED',
  'ESTIMATE_REJECTED',
  'ESTIMATE_APPROVED',
  'IN_PROGRESS',
  'COMPLETION_PENDING',
  'COMPLETED',
  'DISPUTED'
);

CREATE TYPE "CostAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "job_engagements" (
  "id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "response_id" UUID NOT NULL,
  "seeker_id" UUID NOT NULL,
  "provider_id" UUID NOT NULL,
  "status" "JobEngagementStatus" NOT NULL DEFAULT 'ASSESSMENT_PENDING',
  "hourly_rate" DECIMAL(10,2) NOT NULL,
  "assessment_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "estimated_hours" DECIMAL(8,2),
  "estimated_total" DECIMAL(10,2),
  "estimate_notes" VARCHAR(2000),
  "estimate_decision_note" VARCHAR(1000),
  "estimate_submitted_at" TIMESTAMP(3),
  "estimate_decided_at" TIMESTAMP(3),
  "work_started_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "job_engagements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_cost_adjustments" (
  "id" UUID NOT NULL,
  "engagement_id" UUID NOT NULL,
  "requested_hours" DECIMAL(8,2) NOT NULL,
  "hourly_rate" DECIMAL(10,2) NOT NULL,
  "requested_amount" DECIMAL(10,2) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "status" "CostAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
  "decision_note" VARCHAR(1000),
  "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "job_cost_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_engagements_request_id_key" ON "job_engagements"("request_id");
CREATE UNIQUE INDEX "job_engagements_response_id_key" ON "job_engagements"("response_id");
CREATE INDEX "job_engagements_seeker_id_status_created_at_idx" ON "job_engagements"("seeker_id", "status", "created_at");
CREATE INDEX "job_engagements_provider_id_status_created_at_idx" ON "job_engagements"("provider_id", "status", "created_at");
CREATE INDEX "job_cost_adjustments_engagement_id_status_created_at_idx" ON "job_cost_adjustments"("engagement_id", "status", "created_at");

ALTER TABLE "job_engagements" ADD CONSTRAINT "job_engagements_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_engagements" ADD CONSTRAINT "job_engagements_response_id_fkey"
  FOREIGN KEY ("response_id") REFERENCES "provider_responses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_cost_adjustments" ADD CONSTRAINT "job_cost_adjustments_engagement_id_fkey"
  FOREIGN KEY ("engagement_id") REFERENCES "job_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
