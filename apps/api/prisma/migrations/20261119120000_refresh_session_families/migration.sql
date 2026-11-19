ALTER TABLE "refresh_sessions"
  ADD COLUMN "token_family_id" UUID;

-- Existing sessions become independent families until their next rotation.
UPDATE "refresh_sessions"
SET "token_family_id" = gen_random_uuid()
WHERE "token_family_id" IS NULL;

ALTER TABLE "refresh_sessions"
  ALTER COLUMN "token_family_id" SET NOT NULL;

CREATE INDEX "refresh_sessions_token_family_id_revoked_at_idx"
  ON "refresh_sessions"("token_family_id", "revoked_at");
