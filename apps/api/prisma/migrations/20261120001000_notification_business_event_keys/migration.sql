-- A business event may create at most one in-app notification per recipient.
-- NULL remains valid for legacy/system notifications without an event identity.
ALTER TABLE "app_notifications"
ADD COLUMN "event_key" VARCHAR(255);

CREATE UNIQUE INDEX "app_notifications_event_key_key"
ON "app_notifications" ("event_key");
