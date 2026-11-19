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
- [ ] Add idempotency keys for client-retried create/decision operations where a duplicate could create a second marketplace action.
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

- [ ] Audit all JobEngagement state transitions for conditional writes and transaction boundaries.
- [ ] Add database constraints for impossible states and unique business invariants.
- [ ] Test completion evidence ownership, estimate/extra-hours approval races, timer pause/resume races, and review uniqueness.
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

- [ ] Replace the default in-memory `@nestjs/throttler` storage with a shared Redis-backed store (or an equivalently atomic shared store) before running multiple API replicas. Current request limits are per process and can be bypassed by spreading requests across replicas.
- [ ] Configure and verify trusted-proxy handling at the deployment boundary before relying on client IP-based throttling. Never trust arbitrary client-supplied forwarded headers.
- [x] Run marketplace deadlines, retries and Expo receipt polling in a separately deployed worker process. API replicas do not start the polling interval; a PostgreSQL transaction-scoped advisory lock prevents overlapping cycles.
- [ ] Ensure worker ownership, health, restart behavior, queue age and failed-notification counts are observable and alerted.

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
5. Authentication still uses the default per-process in-memory throttler. A shared production rate-limit store, trusted-proxy configuration, complete route-by-route authorization audit, and expanded replay/race tests remain outstanding.
6. Load, soak, worker crash/restart, multi-replica, provider outage, backup/restore, and staging recovery tests have not been demonstrated.

## Exit criteria

Production readiness is not declared until all P0 items are complete, the P1 items affecting the deployed architecture are complete, CI passes, PostgreSQL concurrency tests pass, and staging fault/load tests demonstrate recovery. A successful normal user journey alone is not sufficient.
