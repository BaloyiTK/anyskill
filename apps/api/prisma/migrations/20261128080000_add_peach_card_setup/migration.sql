ALTER TABLE "users" ADD COLUMN "peach_customer_id" VARCHAR(100);
CREATE UNIQUE INDEX "users_peach_customer_id_key" ON "users"("peach_customer_id");

CREATE TABLE "peach_card_setups" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "setup_intent_id" VARCHAR(120) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "consent_at" TIMESTAMP(3) NOT NULL,
  "consent_version" VARCHAR(40) NOT NULL DEFAULT 'ANY_SKILL_CARD_ON_FILE_V1',
  "card_brand" VARCHAR(40),
  "last_four" VARCHAR(4),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "failure_reason" VARCHAR(1000),
  CONSTRAINT "peach_card_setups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "peach_card_setups_setup_intent_id_key" ON "peach_card_setups"("setup_intent_id");
CREATE INDEX "peach_card_setups_user_id_status_created_at_idx" ON "peach_card_setups"("user_id", "status", "created_at");
ALTER TABLE "peach_card_setups" ADD CONSTRAINT "peach_card_setups_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "peach_saved_payment_methods" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "peach_payment_method_id" VARCHAR(120) NOT NULL,
  "card_brand" VARCHAR(40),
  "last_four" VARCHAR(4),
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "consent_at" TIMESTAMP(3) NOT NULL,
  "consent_version" VARCHAR(40) NOT NULL DEFAULT 'ANY_SKILL_CARD_ON_FILE_V1',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "peach_saved_payment_methods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "peach_saved_payment_methods_peach_payment_method_id_key" ON "peach_saved_payment_methods"("peach_payment_method_id");
CREATE INDEX "peach_saved_payment_methods_user_id_status_created_at_idx" ON "peach_saved_payment_methods"("user_id", "status", "created_at");
ALTER TABLE "peach_saved_payment_methods" ADD CONSTRAINT "peach_saved_payment_methods_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
