ALTER TABLE "app_notifications"
  ADD COLUMN "delivery_started_at" TIMESTAMP(3);

-- Preserve recovery for notifications that were already in-flight before this
-- migration. Their original creation time is the only available safe fallback.
UPDATE "app_notifications"
SET "delivery_started_at" = "created_at"
WHERE "delivery_status" = 'SENDING' AND "delivery_started_at" IS NULL;
