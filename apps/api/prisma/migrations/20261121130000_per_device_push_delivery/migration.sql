CREATE TABLE "notification_device_deliveries" (
  "id" UUID NOT NULL,
  "notification_id" UUID NOT NULL,
  "push_device_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expo_ticket_id" VARCHAR(100),
  "accepted_at" TIMESTAMP(3),
  "receipt_checked_at" TIMESTAMP(3),
  "last_error" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_device_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notification_device_deliveries_notification_id_push_device_id_key"
  ON "notification_device_deliveries"("notification_id", "push_device_id");
CREATE UNIQUE INDEX "notification_device_deliveries_expo_ticket_id_key"
  ON "notification_device_deliveries"("expo_ticket_id");
CREATE INDEX "notification_device_deliveries_status_next_attempt_at_idx"
  ON "notification_device_deliveries"("status", "next_attempt_at");
CREATE INDEX "notification_device_deliveries_status_accepted_at_receipt_checked_at_idx"
  ON "notification_device_deliveries"("status", "accepted_at", "receipt_checked_at");
ALTER TABLE "notification_device_deliveries"
  ADD CONSTRAINT "notification_device_deliveries_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "app_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_device_deliveries"
  ADD CONSTRAINT "notification_device_deliveries_push_device_id_fkey"
  FOREIGN KEY ("push_device_id") REFERENCES "push_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
