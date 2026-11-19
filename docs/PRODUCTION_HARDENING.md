# AnySkill production hardening

Base: `feature/shared-job-work-timer`
Working branch: `hardening/production-readiness`

This checklist is an engineering gate, not a claim that the platform is production-ready. Existing happy-path validation (registration through provider acceptance) and passing CI are retained as baseline evidence. Each item must be implemented and tested before the corresponding gate is marked complete.

## P0 — Marketplace correctness and recoverability

- [x] Make matching wave creation atomic under concurrent API/worker instances. Request-scoped PostgreSQL advisory locks serialize dispatch; notifications are created only for match rows actually inserted. PostgreSQL concurrency test is being added to CI.
- [x] Separate worker execution from API replicas. API processes no longer start the polling loop; `apps/api/src/worker.ts` starts a dedicated Nest application context, and PostgreSQL transaction-scoped advisory locking provides single-cycle ownership across worker replicas. Connection loss releases the lock automatically. A separate lease/heartbeat is not needed for this lock-based design.
- [x] Recover notifications stranded in `SENDING` after process termination; stale claims are recovered with bounded retries/backoff and terminal failure.
- [x] Handle Expo push tickets and receipts separately. Persist ticket IDs, poll receipts, and invalidate `DeviceNotRegistered` tokens; ticket acceptance is not treated as handset delivery.
- [x] Serialize provider offer creation, seeker selection, cancellation, and rescheduling using the same request-scoped PostgreSQL lock; conditional state updates protect the final transition. Integration tests are being added to CI.
- [x] Add database-backed idempotency for service-request creation. `Idempotency-Key` is scoped to the authenticated seeker, payloads are SHA-256 bound, duplicate retries replay the original request, and reusing a key with a different payload returns HTTP 409. The key is optional during client rollout; clients must send and persist one UUID per logical submission.
- [x] Complete PostgreSQL integration tests for competing provider selections, cancellation versus selection, and duplicate dispatch. The CI workflow executes them against PostgreSQL.

## P0 — Authentication and authorization

- [x] Enforce JWT algorithm, issuer, audience, and token type; keep short access-token expiry and refresh rotation/reuse detection.
- [ ] Apply stricter throttling to refresh/logout and sensitive authentication endpoints, with a production-safe shared rate-limit store across replicas.
- [ ] Audit every seeker/provider/staff route for role, ownership, suspension, deleted-account, and identity-verification enforcement.
- [ ] Test refresh rotation races, token replay, password-reset replay, OTP brute force/resend races, account deletion, and session revocation.
- [ ] Ensure production secrets, CORS allow-list, proxy trust, and cookie/token handling are validated at startup.

## P1 — Notifications and background processing

- [ ] Bound outbound HTTP timeouts and batch sizes; retry transient failures only.
- [ ] Add worker metrics: queue age/depth, claim age, attempts, expired leases, receipt failures, and processing latency.
- [ ] Ensure in-app notification creation is transactional with the business event (outbox pattern).
- [ ] Add operational alerts for stuck work, exhausted retries, and matching requests approaching expiry.

## P1 — Data integrity and marketplace lifecycle

- [x] Audit and serialize JobEngagement lifecycle transitions. Estimate submission/decision, work start/pause/resume, additional-hours request/decision, and completion submission/decision now acquire the same PostgreSQL transaction-scoped engagement lock before reading state and writing outcomes.
- [x] Add partial unique database indexes allowing at most one PENDING additional-hours adjustment and one PENDING completion submission per engagement. Migration `20261119173000_job_lifecycle_pending_uniqueness` enforces both invariants independently of application locks.
- [x] Add PostgreSQL concurrency integration tests for competing estimate submissions, duplicate pending additional-hours requests, and competing completion decisions. The integration suite also verifies both partial unique indexes. Completion evidence ownership, timer pause/resume race coverage, and review uniqueness remain additional test cases.
- [ ] Verify cancellation/withdrawal behavior does not leave active matches or engagements behind.

## P1 — API and infrastructure

- [ ] Validate request DTO limits and coordinate/range checks; cap pagination and expensive discovery queries.
- [ ] Add production health/readiness checks (database connectivity, migration compatibility, worker health) and graceful shutdown.
- [ ] Replace local-only error-file logging with structured centralized logs; redact credentials, tokens, PII, and location data.
- [ ] Add request correlation, metrics, tracing, and alert thresholds.
- [ ] Verify backup/restore, migration rollback strategy, connection-pool sizing, and deployment rollback.

## P1 — Security and release verification

- [ ] Run dependency and secret scanning, static analysis, and security-focused integration tests in CI.
- [ ] Add load/soak tests for matching, notification fan-out, authentication, and concurrent offer selection.
- [ ] Test worker crash/restart, database interruption, Expo outage, duplicate webhook/event delivery, and multi-replica execution.
- [ ] Document incident response, support/admin recovery procedures, data retention, privacy, and POPIA controls.

## P0 — Payments and financial integrity

- [ ] Do not enable real-money collection until PayGate merchant product, sandbox credentials, stored-card tokenisation, pre-authorisation, delayed capture, signed notifications, void/refund, and reconciliation capabilities are confirmed in writing. The approved payment architecture explicitly says these are not yet implemented.
- [ ] Before launch, implement idempotent authorisation/capture/void/refund operations, verified webhook ingestion with replay protection, immutable financial ledger entries, and gateway reconciliation.
- [ ] Confirm a compliant Provider payout rail; card acquiring settlement must not be represented as Provider payout.

## P0 — Multi-instance runtime controls

- [x] Replace the default in-memory `@nestjs/throttler` storage with an atomic shared Redis-backed store for production. The custom Upstash Redis REST storage uses a Lua script for atomic sliding-window counters and block state; it fails closed with HTTP 503 if the shared store is unavailable. Local development retains the built-in in-memory store when Redis credentials are absent.
- [x] Configure explicit Express trusted-proxy hops using `TRUST_PROXY_HOPS` (integer 0–10, default 0). Forwarded client IP headers are not trusted by default; production must set the exact proxy hop count for its deployment topology.
- [x] Run marketplace deadlines, retries and Expo receipt polling in a separately deployed worker process. API replicas do not start the polling interval; a PostgreSQL transaction-scoped advisory lock prevents overlapping cycles.
- [ ] Ensure worker ownership, health, restart behavior, queue age and failed-notification counts are observable and alerted.

## Service request idempotency

For every logical service-request submission, clients should generate a UUID once, persist it until the operation has a definitive result, and send it on every retry:

```http
POST /api/v1/marketplace/requests
Idempotency-Key: 8d6d6d20-6c0d-4e37-9ac2-7b1db54a1f20
Content-Type: application/json
```

The key is unique per authenticated seeker. The API stores a SHA-256 hash of the normalized request payload alongside the created request. A retry with the same key and same payload returns the existing request and does not create another marketplace request. Reusing the key with a different payload returns HTTP 409. The database unique index is the cross-replica concurrency boundary. During mobile-client rollout the header remains optional for backward compatibility; requests without it retain legacy non-idempotent behavior. Do not generate a new key for a network retry.

## Shared rate-limit deployment

Production API and worker environments must include the same shared Redis REST configuration:

- `UPSTASH_REDIS_REST_URL`: HTTPS REST endpoint for the production Redis database.
- `UPSTASH_REDIS_REST_TOKEN`: write-capable token restricted to the rate-limit database/namespace.
- `TRUST_PROXY_HOPS`: exact number of trusted reverse-proxy hops between the public client and the API (integer 0–10). Use `0` when the API is directly exposed; never use a blanket trust-all setting.

The API refuses to start in production if the Redis endpoint/token are missing or the endpoint is not HTTPS. Rate-limit increments are atomic in Redis; if Redis is unavailable, the API rejects the request with HTTP 503 rather than silently disabling abuse protection. Local development without Redis continues to use Nest's in-memory store and is not representative of multi-replica production behavior.

## Dedicated worker deployment

Build the API package once, then run two separate processes/containers from the same release artifact:

- API process: `pnpm --filter @anyskill/api start:prod` (the HTTP entrypoint forces the role to `api`, even if a worker variable is accidentally inherited).
- Worker process: set `ANYSKILL_PROCESS_ROLE=worker`, then run `pnpm --filter @anyskill/api start:worker`.

PowerShell worker command:

```powershell
$env:ANYSKILL_PROCESS_ROLE = "worker"
pnpm --filter @anyskill/api start:worker
```

Linux/container worker command:

```sh
ANYSKILL_PROCESS_ROLE=worker pnpm --filter @anyskill/api start:worker
```

Both processes must use the same production database and compatible environment configuration. Deploy the worker as a separately supervised service with restart-on-failure and graceful termination. Do not set the worker role on API replicas. The worker entrypoint refuses to start without the explicit worker role. The database advisory lock is a concurrency guard, not a substitute for process supervision, monitoring, or a worker health alert.

## Current source-audit findings

1. `MarketplaceService.onModuleInit` starts the 15-second poller only when `ANYSKILL_PROCESS_ROLE=worker`. `apps/api/src/worker.ts` boots a Nest application context without opening an HTTP listener. Run at least one dedicated worker deployment alongside API replicas; PostgreSQL advisory locking prevents overlapping cycles and is released on transaction/connection termination.
2. Matching dispatch, cancellation, selection, provider offer creation, and rescheduling now share request-scoped PostgreSQL locking and conditional state transitions. PostgreSQL integration tests for selection races, cancellation races, and duplicate dispatch are included in CI and passed on commit `578e4cf`.
3. Notification delivery now recovers stale `SENDING` claims, retries with bounded backoff, persists Expo tickets, polls receipts, and removes invalid device tokens. Operational metrics, alerts, and a durable outbox remain outstanding.
4. The approved PayGate payment workflow is documented but not implemented. Merchant capabilities and sandbox credentials are unconfirmed. Do not accept live payments or describe payment/settlement as production-ready.
5. Production throttling now uses atomic Upstash Redis REST storage and explicit trusted-proxy hop configuration. The deployment must provide valid `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and the correct `TRUST_PROXY_HOPS`; route-by-route authorization and expanded replay/race tests remain outstanding.
6. Load, soak, worker crash/restart, multi-replica, provider outage, backup/restore, and staging recovery tests have not been demonstrated.

8. Job lifecycle state transitions now serialize by request ID using PostgreSQL transaction-scoped advisory locks. The lock is acquired before reading the engagement state and is held through the transaction, preventing concurrent estimate overwrites, duplicate pending extra-hours requests, timer state races, and competing completion decisions across API replicas. Integration tests for estimate, extra-hours, and completion races have been added and are awaiting CI.

7. Public Google Places autocomplete, place-details, reverse-geocoding, and provider-discovery endpoints now have explicit per-IP throttles. Google Places and Geocoding outbound requests have a five-second timeout and return bounded gateway errors. Other outbound integrations still require a complete timeout/retry audit.

## Exit criteria

Production readiness is not declared until all P0 items are complete, the P1 items affecting the deployed architecture are complete, CI passes, PostgreSQL concurrency tests pass, and staging fault/load tests demonstrate recovery. A successful normal user journey alone is not sufficient.
