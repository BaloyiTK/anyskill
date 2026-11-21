ALTER TABLE "app_notifications"
  ADD COLUMN "sending_started_at" TIMESTAMP(3),
  ADD COLUMN "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "app_notifications_delivery_status_next_attempt_at_created_at_idx"
  ON "app_notifications"("delivery_status", "next_attempt_at", "created_at");
