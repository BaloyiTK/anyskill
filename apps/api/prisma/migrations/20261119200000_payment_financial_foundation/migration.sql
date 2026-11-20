CREATE TYPE "PaymentMethodStatus" AS ENUM ('SETUP_PENDING','ACTIVE','REQUIRES_UPDATE','REMOVED');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING','AUTHORIZATION_PENDING','AUTHORIZED','CAPTURE_PENDING','CAPTURED','FAILED','CANCELLED','RECONCILIATION_REQUIRED','REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED');
CREATE TYPE "PaymentOperationType" AS ENUM ('AUTHORIZE','CAPTURE','VOID','REFUND');
CREATE TYPE "PaymentOperationStatus" AS ENUM ('PENDING','SUCCEEDED','FAILED','UNKNOWN');
CREATE TYPE "PaymentWebhookStatus" AS ENUM ('RECEIVED','PROCESSING','PROCESSED','FAILED');
CREATE TYPE "ProviderPayoutStatus" AS ENUM ('PENDING','PROCESSING','PAID','FAILED','REVERSED');
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT','CREDIT');

CREATE TABLE "payment_methods" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "provider" VARCHAR(40) NOT NULL DEFAULT 'PAYGATE',
  "gateway_method_reference" VARCHAR(255) NOT NULL,
  "gateway_customer_reference" VARCHAR(255),
  "encrypted_token" TEXT NOT NULL,
  "encryption_key_version" VARCHAR(80) NOT NULL,
  "brand" VARCHAR(40),
  "last4" CHAR(4),
  "status" "PaymentMethodStatus" NOT NULL DEFAULT 'SETUP_PENDING',
  "consent_at" TIMESTAMP(3) NOT NULL,
  "consent_version" VARCHAR(40) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_methods_last4_check" CHECK ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$'),
  CONSTRAINT "payment_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payment_methods_gateway_method_reference_key" ON "payment_methods"("gateway_method_reference");
CREATE INDEX "payment_methods_user_id_status_idx" ON "payment_methods"("user_id","status");

CREATE TABLE "payments" (
  "id" UUID NOT NULL,
  "engagement_id" UUID NOT NULL,
  "seeker_id" UUID,
  "provider_id" UUID,
  "payment_method_id" UUID,
  "currency" CHAR(3) NOT NULL DEFAULT 'ZAR',
  "estimate_version" INTEGER NOT NULL,
  "amount_authorized_minor" BIGINT,
  "amount_captured_minor" BIGINT,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "gateway_transaction_reference" VARCHAR(255),
  "authorized_at" TIMESTAMP(3),
  "captured_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_amounts_nonnegative_check" CHECK (
    ("amount_authorized_minor" IS NULL OR "amount_authorized_minor" >= 0) AND
    ("amount_captured_minor" IS NULL OR "amount_captured_minor" >= 0)
  ),
  CONSTRAINT "payments_estimate_version_positive_check" CHECK ("estimate_version" > 0),
  CONSTRAINT "payments_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "job_engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payments_seeker_id_fkey" FOREIGN KEY ("seeker_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "payments_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payments_engagement_id_key" ON "payments"("engagement_id");
CREATE UNIQUE INDEX "payments_gateway_transaction_reference_key" ON "payments"("gateway_transaction_reference");
CREATE INDEX "payments_seeker_id_status_created_at_idx" ON "payments"("seeker_id","status","created_at");
CREATE INDEX "payments_provider_id_status_created_at_idx" ON "payments"("provider_id","status","created_at");
CREATE INDEX "payments_status_updated_at_idx" ON "payments"("status","updated_at");

CREATE TABLE "payment_operations" (
  "id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "type" "PaymentOperationType" NOT NULL,
  "status" "PaymentOperationStatus" NOT NULL DEFAULT 'PENDING',
  "idempotency_key" VARCHAR(120) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "gateway_reference" VARCHAR(255),
  "failure_code" VARCHAR(100),
  "safe_response" JSONB,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "payment_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_operations_amount_positive_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "payment_operations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payment_operations_idempotency_key_key" ON "payment_operations"("idempotency_key");
CREATE UNIQUE INDEX "payment_operations_gateway_reference_key" ON "payment_operations"("gateway_reference");
CREATE INDEX "payment_operations_payment_id_type_status_idx" ON "payment_operations"("payment_id","type","status");
CREATE INDEX "payment_operations_status_requested_at_idx" ON "payment_operations"("status","requested_at");

CREATE TABLE "payment_webhook_events" (
  "id" UUID NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "provider_event_id" VARCHAR(255) NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "normalized_payload" JSONB NOT NULL,
  "signature_verified" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" "PaymentWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "last_error" VARCHAR(500),
  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_webhook_events_attempts_check" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "payment_webhook_events_provider_provider_event_id_key" ON "payment_webhook_events"("provider","provider_event_id");
CREATE INDEX "payment_webhook_events_status_received_at_idx" ON "payment_webhook_events"("status","received_at");

CREATE TABLE "provider_payouts" (
  "id" UUID NOT NULL,
  "provider_id" UUID,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" "ProviderPayoutStatus" NOT NULL DEFAULT 'PENDING',
  "idempotency_key" VARCHAR(120) NOT NULL,
  "payout_rail" VARCHAR(60) NOT NULL,
  "external_reference" VARCHAR(255),
  "failure_code" VARCHAR(100),
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "provider_payouts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_payouts_amount_positive_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "provider_payouts_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "provider_payouts_idempotency_key_key" ON "provider_payouts"("idempotency_key");
CREATE UNIQUE INDEX "provider_payouts_external_reference_key" ON "provider_payouts"("external_reference");
CREATE INDEX "provider_payouts_provider_id_status_requested_at_idx" ON "provider_payouts"("provider_id","status","requested_at");
CREATE INDEX "provider_payouts_status_requested_at_idx" ON "provider_payouts"("status","requested_at");

CREATE TABLE "financial_ledger_entries" (
  "id" UUID NOT NULL,
  "entry_group_id" UUID NOT NULL,
  "payment_id" UUID,
  "account_code" VARCHAR(80) NOT NULL,
  "direction" "LedgerDirection" NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financial_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "financial_ledger_entries_amount_positive_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "financial_ledger_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "financial_ledger_entries_idempotency_key_key" ON "financial_ledger_entries"("idempotency_key");
CREATE INDEX "financial_ledger_entries_entry_group_id_idx" ON "financial_ledger_entries"("entry_group_id");
CREATE INDEX "financial_ledger_entries_payment_id_created_at_idx" ON "financial_ledger_entries"("payment_id","created_at");
CREATE INDEX "financial_ledger_entries_account_code_currency_created_at_idx" ON "financial_ledger_entries"("account_code","currency","created_at");

-- Financial ledger history is append-only. Corrections must be compensating entries.
CREATE FUNCTION prevent_financial_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'financial_ledger_entries is append-only; insert a compensating entry';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "financial_ledger_entries_no_update"
BEFORE UPDATE OR DELETE ON "financial_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION prevent_financial_ledger_mutation();
