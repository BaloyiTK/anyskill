-- Controlled, one-time bootstrap for the initial AnySkill Super Administrator.
-- Replace owner@example.com with the exact email of the owner's EXISTING,
-- email-verified AnySkill account before running this file.
--
-- Run only after migrations have been deployed. The operation is idempotent
-- for the same owner account and refuses to overwrite another staff role or
-- appoint a second Super Administrator.

BEGIN;

-- Serialize concurrent bootstrap attempts.
SELECT pg_advisory_xact_lock(hashtext('anyskill.initial_super_admin'));

DO $$
DECLARE
  owner_user_id UUID;
  existing_super_admin_id UUID;
  existing_staff_role "StaffRole";
BEGIN
  SELECT "id"
    INTO owner_user_id
  FROM "users"
  WHERE lower("email") = lower('owner@example.com')
    AND "email_verified_at" IS NOT NULL
    AND "deleted_at" IS NULL;

  IF owner_user_id IS NULL THEN
    RAISE EXCEPTION
      'Bootstrap refused: no active AnySkill account with this email and a verified email address was found';
  END IF;

  SELECT "user_id"
    INTO existing_super_admin_id
  FROM "staff_memberships"
  WHERE "role" = 'SUPER_ADMIN'
  LIMIT 1;

  IF existing_super_admin_id IS NOT NULL
     AND existing_super_admin_id <> owner_user_id THEN
    RAISE EXCEPTION
      'Bootstrap refused: a different Super Administrator already exists';
  END IF;

  SELECT "role"
    INTO existing_staff_role
  FROM "staff_memberships"
  WHERE "user_id" = owner_user_id;

  IF existing_staff_role IS NOT NULL
     AND existing_staff_role <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION
      'Bootstrap refused: the owner account already has a staff role; review it explicitly before proceeding';
  END IF;

  INSERT INTO "staff_memberships"
    ("id", "user_id", "role", "is_active", "created_at", "updated_at")
  VALUES
    (gen_random_uuid(), owner_user_id, 'SUPER_ADMIN', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT ("user_id") DO UPDATE
    SET "is_active" = TRUE,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "staff_memberships"."role" = 'SUPER_ADMIN';

  IF NOT EXISTS (
    SELECT 1
    FROM "staff_memberships"
    WHERE "user_id" = owner_user_id
      AND "role" = 'SUPER_ADMIN'
      AND "is_active" = TRUE
  ) THEN
    RAISE EXCEPTION 'Bootstrap failed: Super Administrator membership was not created';
  END IF;
END $$;

COMMIT;
