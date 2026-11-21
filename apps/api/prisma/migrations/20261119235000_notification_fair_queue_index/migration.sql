-- Support fair queue selection: one due notification per recipient, ordered by age.
CREATE INDEX "app_notifications_fair_queue_idx"
ON "app_notifications" ("delivery_status", "next_attempt_at", "user_id", "created_at");
