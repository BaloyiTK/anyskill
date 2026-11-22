CREATE TYPE "JobDisputeStatus" AS ENUM ('OPEN','UNDER_REVIEW','RESOLVED_PROVIDER','RESOLVED_SEEKER','RESOLVED_CANCELLED');
CREATE TABLE "job_disputes" (
 "id" UUID NOT NULL, "engagement_id" UUID NOT NULL, "opened_by_id" UUID NOT NULL, "resolved_by_id" UUID,
 "reason" VARCHAR(2000) NOT NULL, "status" "JobDisputeStatus" NOT NULL DEFAULT 'OPEN', "resolution_note" VARCHAR(2000),
 "resolved_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "job_disputes_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "job_disputes_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "job_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "job_disputes_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "job_disputes_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "job_disputes_engagement_id_key" ON "job_disputes"("engagement_id");
CREATE INDEX "job_disputes_status_created_at_idx" ON "job_disputes"("status","created_at");
CREATE INDEX "job_disputes_opened_by_id_created_at_idx" ON "job_disputes"("opened_by_id","created_at");
CREATE TABLE "job_dispute_messages" (
 "id" UUID NOT NULL, "dispute_id" UUID NOT NULL, "author_id" UUID NOT NULL, "body" VARCHAR(2000) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "job_dispute_messages_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "job_dispute_messages_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "job_disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "job_dispute_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "job_dispute_messages_dispute_id_created_at_idx" ON "job_dispute_messages"("dispute_id","created_at");
CREATE INDEX "job_dispute_messages_author_id_created_at_idx" ON "job_dispute_messages"("author_id","created_at");
ALTER TABLE "media_assets" ADD COLUMN "dispute_message_id" UUID;
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_dispute_message_id_fkey" FOREIGN KEY ("dispute_message_id") REFERENCES "job_dispute_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "media_assets_dispute_message_id_idx" ON "media_assets"("dispute_message_id");
CREATE UNIQUE INDEX "job_cost_adjustments_one_pending_per_engagement_idx" ON "job_cost_adjustments" ("engagement_id") WHERE "status" = 'PENDING';
