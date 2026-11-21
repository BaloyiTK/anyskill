ALTER TABLE "push_notification_receipts"
  ADD COLUMN "check_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_check_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP INDEX IF EXISTS "push_notification_receipts_status_created_at_idx";
CREATE INDEX "push_notification_receipts_status_next_check_at_created_at_idx"
  ON "push_notification_receipts"("status", "next_check_at", "created_at");
