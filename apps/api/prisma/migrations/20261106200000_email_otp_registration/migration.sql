CREATE TYPE "RegistrationMode" AS ENUM ('SEEKER', 'PROVIDER');
ALTER TABLE "users" ADD COLUMN "initial_mode" "RegistrationMode" NOT NULL DEFAULT 'SEEKER';
CREATE TABLE "pending_registrations" (
 "id" UUID NOT NULL, "email" VARCHAR(320) NOT NULL, "mode" "RegistrationMode" NOT NULL,
 "otp_hash" VARCHAR(64) NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
 "expires_at" TIMESTAMP(3) NOT NULL, "resend_available_at" TIMESTAMP(3) NOT NULL,
 "verified_at" TIMESTAMP(3), "registration_token_hash" VARCHAR(64), "registration_token_expires_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "pending_registrations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pending_registrations_email_key" ON "pending_registrations"("email");
CREATE UNIQUE INDEX "pending_registrations_registration_token_hash_key" ON "pending_registrations"("registration_token_hash");
CREATE INDEX "pending_registrations_expires_at_idx" ON "pending_registrations"("expires_at");
