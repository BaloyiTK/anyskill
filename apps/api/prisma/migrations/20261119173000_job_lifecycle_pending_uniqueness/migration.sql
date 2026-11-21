-- Enforce at most one unresolved approval item per engagement even if a future
-- writer bypasses the service-level advisory lock.
CREATE UNIQUE INDEX "job_cost_adjustments_one_pending_per_engagement"
ON "job_cost_adjustments" ("engagement_id")
WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX "job_completion_submissions_one_pending_per_engagement"
ON "job_completion_submissions" ("engagement_id")
WHERE "status" = 'PENDING';
