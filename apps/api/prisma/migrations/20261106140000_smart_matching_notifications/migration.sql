CREATE TYPE "RequestMatchStatus" AS ENUM ('NOTIFIED', 'RESPONDED', 'EXPIRED');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'IN_APP_ONLY', 'FAILED');

ALTER TABLE "service_requests"
  ADD COLUMN "matching_wave" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "matching_next_at" TIMESTAMP(3),
  ADD COLUMN "matching_exhausted_at" TIMESTAMP(3);

CREATE TABLE "provider_profiles" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "skill_categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "service_areas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "delivery_modes" TEXT[] NOT NULL DEFAULT ARRAY['ONSITE']::TEXT[],
  "is_available" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "request_matches" (
  "id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "provider_id" UUID NOT NULL,
  "score" INTEGER NOT NULL,
  "wave" INTEGER NOT NULL,
  "status" "RequestMatchStatus" NOT NULL DEFAULT 'NOTIFIED',
  "notified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "request_matches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "request_matches_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "push_devices" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "expo_push_token" VARCHAR(255) NOT NULL,
  "platform" VARCHAR(30) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "app_notifications" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "body" VARCHAR(500) NOT NULL,
  "data" JSONB,
  "delivery_status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "read_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "app_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "provider_profiles_user_id_key" ON "provider_profiles"("user_id");
CREATE INDEX "provider_profiles_is_available_idx" ON "provider_profiles"("is_available");
CREATE UNIQUE INDEX "request_matches_request_id_provider_id_key" ON "request_matches"("request_id", "provider_id");
CREATE INDEX "request_matches_provider_id_status_created_at_idx" ON "request_matches"("provider_id", "status", "created_at");
CREATE INDEX "request_matches_request_id_wave_idx" ON "request_matches"("request_id", "wave");
CREATE UNIQUE INDEX "push_devices_expo_push_token_key" ON "push_devices"("expo_push_token");
CREATE INDEX "push_devices_user_id_idx" ON "push_devices"("user_id");
CREATE INDEX "app_notifications_user_id_read_at_created_at_idx" ON "app_notifications"("user_id", "read_at", "created_at");
CREATE INDEX "app_notifications_delivery_status_created_at_idx" ON "app_notifications"("delivery_status", "created_at");
