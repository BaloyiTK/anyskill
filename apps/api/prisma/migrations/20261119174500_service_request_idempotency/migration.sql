ALTER TABLE "service_requests"
  ADD COLUMN "idempotency_key" VARCHAR(100),
  ADD COLUMN "idempotency_payload_hash" CHAR(64);

CREATE UNIQUE INDEX "service_requests_seeker_idempotency_key_key"
  ON "service_requests" ("seeker_id", "idempotency_key");
