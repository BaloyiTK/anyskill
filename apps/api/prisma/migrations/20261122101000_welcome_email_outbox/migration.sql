CREATE TABLE "welcome_email_outbox" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "recipient_email" VARCHAR(320) NOT NULL,
  "display_name" VARCHAR(200) NOT NULL DEFAULT '',
  "provider_review_pending" BOOLEAN NOT NULL DEFAULT false,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMP(3),
  "last_error" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "welcome_email_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "welcome_email_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "welcome_email_outbox_user_id_key" ON "welcome_email_outbox"("user_id");
CREATE INDEX "welcome_email_outbox_status_next_attempt_at_idx" ON "welcome_email_outbox"("status", "next_attempt_at");
