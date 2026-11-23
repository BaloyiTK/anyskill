CREATE TABLE "job_financial_transactions" (
  "id" UUID NOT NULL,
  "engagement_id" UUID NOT NULL,
  "transaction_type" VARCHAR(30) NOT NULL,
  "mode" VARCHAR(20) NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'ZAR',
  "external_provider" VARCHAR(50),
  "external_reference" VARCHAR(255),
  "idempotency_key" VARCHAR(160) NOT NULL,
  "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "simulated_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "failure_reason" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "job_financial_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "job_financial_transactions_engagement_id_fkey"
    FOREIGN KEY ("engagement_id") REFERENCES "job_engagements"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "job_financial_transactions_idempotency_key_key"
  ON "job_financial_transactions"("idempotency_key");
CREATE UNIQUE INDEX "job_financial_transactions_engagement_id_transaction_type_key"
  ON "job_financial_transactions"("engagement_id", "transaction_type");
CREATE INDEX "job_financial_transactions_transaction_type_status_completed_at_idx"
  ON "job_financial_transactions"("transaction_type", "status", "completed_at");
CREATE INDEX "job_financial_transactions_engagement_id_created_at_idx"
  ON "job_financial_transactions"("engagement_id", "created_at");

CREATE INDEX "job_engagements_provider_payment_simulated_at_idx"
  ON "job_engagements"("provider_id", "payment_status", "payment_simulated_at");
