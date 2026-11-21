CREATE TABLE "service_chat_messages" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_chat_messages_request_id_created_at_idx"
    ON "service_chat_messages"("request_id", "created_at");
CREATE INDEX "service_chat_messages_sender_id_created_at_idx"
    ON "service_chat_messages"("sender_id", "created_at");

ALTER TABLE "service_chat_messages"
    ADD CONSTRAINT "service_chat_messages_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "service_requests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_chat_messages"
    ADD CONSTRAINT "service_chat_messages_sender_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
