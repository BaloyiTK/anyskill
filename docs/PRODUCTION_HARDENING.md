# AnySkill production hardening

Base: `feature/shared-job-work-timer`
Working branch: `hardening/production-readiness`

This checklist is an engineering gate, not a claim that the platform is production-ready. Existing happy-path validation (registration through provider acceptance) and passing CI are retained as baseline evidence. Each item must be implemented and tested before the corresponding gate is marked complete.

## P0 — Marketplace correctness and recoverability

- [ ] Make matching wave creation atomic under concurrent API/worker instances. Lock or claim each request in PostgreSQL before ranking/dispatch; create notifications only for match rows actually inserted.
- [ ] Make worker ownership distributed and recoverable. Do not run an uncoordinated poller in every API replica. Use a dedicated worker entrypoint and a database-backed lease/claim strategy with expiry and heartbeat.
- [ ] Recover notifications stranded in `SENDING` after process termination; use bounded retries with backoff and a terminal failure/dead-letter path.
- [ ] Handle Expo push tickets and receipts separately. A ticket accepted by Expo is not proof of handset delivery; persist ticket IDs, poll receipts, and invalidate `DeviceNotRegistered` tokens.
- [ ] Make provider offer creation and seeker selection race-safe, including duplicate requests, simultaneous provider submissions, seeker cancellation, and selection. Verify state transitions and notifications are committed atomically.
- [ ] Add idempotency keys for client-retried create/decision operations where a duplicate could create a second marketplace action.
- [ ] Add integration tests that run competing transactions against PostgreSQL, not mocked Prisma calls.

## P0 — Authentication and authorization

- [ ] Enforce JWT algorithm, issuer, audience, and token type; keep short access-token expiry and refresh rotation/reuse detection.
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

## Current source-audit findings

1. `MarketplaceService.onModuleInit` starts a 15-second poller inside the API module. Its `workerRunning` boolean is process-local; it cannot coordinate multiple API replicas.
2. `dispatchNextWave` ranks and reads existing matches before its transaction. `createMany(skipDuplicates: true)` may insert fewer rows than candidates, while notification rows are still created for every candidate and the returned `notified` count is the candidate count.
3. `dispatchPendingNotifications` claims rows as `SENDING` but there is no lease timestamp/recovery query for stale `SENDING` rows. It also treats successful Expo tickets as `SENT` without receipt polling.
4. `selectProvider` has a conditional request close, but the full set of competing response/selection/cancellation races has no demonstrated integration coverage yet.
5. Authentication has per-route throttles for several sensitive routes, but refresh/logout have no route-specific throttle. The global in-memory throttler configuration must be assessed for multi-instance production use.
6. JWT strategy validates token type and expiry and uses a strong configured secret, but issuer, audience, and allowed algorithm are not explicitly constrained in the strategy.

## Exit criteria

Production readiness is not declared until all P0 items are complete, the P1 items affecting the deployed architecture are complete, CI passes, PostgreSQL concurrency tests pass, and staging fault/load tests demonstrate recovery. A successful normal user journey alone is not sufficient.
