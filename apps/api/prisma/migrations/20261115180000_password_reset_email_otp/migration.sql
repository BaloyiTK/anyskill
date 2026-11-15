CREATE TABLE "password_reset_otps" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "otp_hash" VARCHAR(64) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "resend_available_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_reset_otps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_otps_user_id_key" ON "password_reset_otps"("user_id");
CREATE INDEX "password_reset_otps_expires_at_idx" ON "password_reset_otps"("expires_at");

ALTER TABLE "password_reset_otps"
ADD CONSTRAINT "password_reset_otps_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
