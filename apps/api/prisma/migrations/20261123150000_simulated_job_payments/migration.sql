ALTER TABLE "job_engagements"
  ADD COLUMN "payment_status" VARCHAR(30) NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN "payment_simulated_at" TIMESTAMP(3),
  ADD COLUMN "provider_payout_status" VARCHAR(30) NOT NULL DEFAULT 'NOT_SENT',
  ADD COLUMN "provider_payout_simulated_at" TIMESTAMP(3);
