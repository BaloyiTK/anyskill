CREATE TABLE "worker_heartbeats" (
  "name" VARCHAR(80) NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "heartbeat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_success_at" TIMESTAMP(3),
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" VARCHAR(64),
  "last_cycle_duration_ms" INTEGER,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("name")
);
