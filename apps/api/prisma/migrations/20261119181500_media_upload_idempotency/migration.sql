ALTER TABLE "media_assets"
  ADD COLUMN "idempotency_key" VARCHAR(100),
  ADD COLUMN "idempotency_payload_hash" CHAR(64);

CREATE UNIQUE INDEX "media_assets_user_idempotency_key_key"
  ON "media_assets" ("user_id", "idempotency_key");
