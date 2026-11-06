CREATE TYPE "ServiceRequestStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED', 'COMPLETED');
CREATE TYPE "ProviderResponseStatus" AS ENUM ('OFFERED', 'WITHDRAWN', 'DECLINED', 'SELECTED');
CREATE TYPE "ServiceDeliveryMode" AS ENUM ('ONSITE', 'REMOTE', 'EITHER');

CREATE TABLE "service_requests" (
  "id" UUID NOT NULL,
  "seeker_id" UUID NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "skill_category" VARCHAR(100) NOT NULL,
  "description" VARCHAR(5000) NOT NULL,
  "image_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "location" VARCHAR(500),
  "delivery_mode" "ServiceDeliveryMode" NOT NULL,
  "preferred_start_at" TIMESTAMP(3),
  "instructions" VARCHAR(2000),
  "status" "ServiceRequestStatus" NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_requests_seeker_id_fkey" FOREIGN KEY ("seeker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "provider_responses" (
  "id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "provider_id" UUID NOT NULL,
  "status" "ProviderResponseStatus" NOT NULL DEFAULT 'OFFERED',
  "message" VARCHAR(2000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_responses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_responses_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "provider_responses_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "provider_responses_request_id_provider_id_key" ON "provider_responses"("request_id", "provider_id");
CREATE INDEX "service_requests_status_created_at_idx" ON "service_requests"("status", "created_at");
CREATE INDEX "service_requests_seeker_id_created_at_idx" ON "service_requests"("seeker_id", "created_at");
CREATE INDEX "provider_responses_provider_id_status_created_at_idx" ON "provider_responses"("provider_id", "status", "created_at");
CREATE INDEX "provider_responses_request_id_status_idx" ON "provider_responses"("request_id", "status");
