-- Run once after the owner's normal AnySkill user account exists.
-- Replace owner@example.com with the exact owner account email.
BEGIN;
INSERT INTO "staff_memberships" ("id", "user_id", "role", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", 'SUPER_ADMIN', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" WHERE lower("email") = lower('owner@example.com')
ON CONFLICT ("user_id") DO UPDATE
SET "role" = 'SUPER_ADMIN', "is_active" = TRUE, "updated_at" = CURRENT_TIMESTAMP;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "staff_memberships" WHERE "role" = 'SUPER_ADMIN' AND "is_active" = TRUE) THEN
    RAISE EXCEPTION 'Bootstrap failed: owner account was not found or could not be provisioned';
  END IF;
END $$;
COMMIT;
