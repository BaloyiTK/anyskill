CREATE TABLE "payfast_checkouts" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "engagement_id" UUID NOT NULL,
  "merchant_payment_id" VARCHAR(100) NOT NULL,
  "mode" VARCHAR(20) NOT NULL DEFAULT 'SANDBOX',
  "amount" DECIMAL(10,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'ZAR',
  "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "save_card" BOOLEAN NOT NULL DEFAULT false,
  "external_payment_id" VARCHAR(100),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "failure_reason" VARCHAR(1000),
  CONSTRAINT "payfast_checkouts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "saved_payment_methods" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "provider" VARCHAR(30) NOT NULL DEFAULT 'PAYFAST',
  "token_hash" VARCHAR(64) NOT NULL,
  "encrypted_token" TEXT NOT NULL,
  "token_iv" VARCHAR(32) NOT NULL,
  "token_auth_tag" VARCHAR(32) NOT NULL,
  "card_brand" VARCHAR(40),
  "last_four" VARCHAR(4),
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "consent_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "saved_payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payfast_checkouts_merchant_payment_id_key"
  ON "payfast_checkouts"("merchant_payment_id");
CREATE INDEX "payfast_checkouts_user_id_status_created_at_idx"
  ON "payfast_checkouts"("user_id", "status", "created_at");
CREATE INDEX "payfast_checkouts_engagement_id_status_created_at_idx"
  ON "payfast_checkouts"("engagement_id", "status", "created_at");
CREATE UNIQUE INDEX "saved_payment_methods_token_hash_key"
  ON "saved_payment_methods"("token_hash");
CREATE INDEX "saved_payment_methods_user_id_status_created_at_idx"
  ON "saved_payment_methods"("user_id", "status", "created_at");

ALTER TABLE "payfast_checkouts"
  ADD CONSTRAINT "payfast_checkouts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payfast_checkouts"
  ADD CONSTRAINT "payfast_checkouts_engagement_id_fkey"
  FOREIGN KEY ("engagement_id") REFERENCES "job_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_payment_methods"
  ADD CONSTRAINT "saved_payment_methods_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
