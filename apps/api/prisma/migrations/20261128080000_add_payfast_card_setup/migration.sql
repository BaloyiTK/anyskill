CREATE TABLE "payfast_card_setups" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "merchant_payment_id" VARCHAR(100) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "consent_at" TIMESTAMP(3) NOT NULL,
    "consent_version" VARCHAR(40) NOT NULL DEFAULT 'ANY_SKILL_CARD_ON_FILE_V1',
    "external_payment_id" VARCHAR(100),
    "card_brand" VARCHAR(40),
    "last_four" VARCHAR(4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_reason" VARCHAR(1000),
    CONSTRAINT "payfast_card_setups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payfast_card_setups_merchant_payment_id_key" ON "payfast_card_setups"("merchant_payment_id");
CREATE INDEX "payfast_card_setups_user_id_status_created_at_idx" ON "payfast_card_setups"("user_id", "status", "created_at");
ALTER TABLE "payfast_card_setups" ADD CONSTRAINT "payfast_card_setups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
