CREATE TYPE "PushReceiptStatus" AS ENUM ('PENDING', 'OK', 'ERROR');

CREATE TABLE "push_notification_receipts" (
  "id" UUID NOT NULL,
  "notification_id" UUID NOT NULL,
  "push_device_id" UUID NOT NULL,
  "expo_ticket_id" VARCHAR(255) NOT NULL,
  "status" "PushReceiptStatus" NOT NULL DEFAULT 'PENDING',
  "error_code" VARCHAR(100),
  "error_message" VARCHAR(500),
  "checked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_notification_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_notification_receipts_expo_ticket_id_key"
  ON "push_notification_receipts"("expo_ticket_id");
CREATE INDEX "push_notification_receipts_status_created_at_idx"
  ON "push_notification_receipts"("status", "created_at");
ALTER TABLE "push_notification_receipts"
  ADD CONSTRAINT "push_notification_receipts_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "app_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_notification_receipts"
  ADD CONSTRAINT "push_notification_receipts_push_device_id_fkey"
  FOREIGN KEY ("push_device_id") REFERENCES "push_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
