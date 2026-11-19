# AnySkill production hardening

Base: `feature/shared-job-work-timer`
Working branch: `hardening/production-readiness`

This checklist is an engineering gate, not a claim that the platform is production-ready. Existing happy-path validation (registration through provider acceptance) and passing CI are retained as baseline evidence. Each item must be implemented and tested before the corresponding gate is marked complete.

## P0 — Marketplace correctness and recoverability

- [x] Make matching wave creation atomic under concurrent API/worker instances. Request-scoped PostgreSQL advisory locks serialize dispatch; notifications are created only for match rows actually inserted. PostgreSQL concurrency test is being added to CI.
- [ ] Make worker ownership distributed and recoverable. Do not run an uncoordinated poller in every API replica. Use a dedicated worker entrypoint and a database-backed lease/claim strategy with expiry and heartbeat.
- [x] Recover notifications stranded in `SENDING` after process termination; stale claims are recovered with bounded retries/backoff and terminal failure.
- [x] Handle Expo push tickets and receipts separately. Persist ticket IDs, poll receipts, and invalidate `DeviceNotRegistered` tokens; ticket acceptance is not treated as handset delivery.
- [x] Serialize provider offer creation, seeker selection, cancellation, and rescheduling using the same request-scoped PostgreSQL lock; conditional state updates protect the final transition. Integration tests are being added to CI.
- [ ] Add idempotency keys for client-retried create/decision operations where a duplicate could create a second marketplace action.
- [ ] Complete PostgreSQL integration tests for competing provider selections, cancellation versus selection, and duplicate dispatch. Tests have been added and are awaiting CI execution.

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

## Current source-audit findings

1. `MarketplaceService.onModuleInit` still starts a 15-second poller in each API process. A PostgreSQL advisory lock prevents concurrent worker cycles, but the worker is not yet a separately deployed process with a lease/heartbeat. This remains a production architecture blocker.
2. Matching dispatch, cancellation, selection, provider offer creation, and rescheduling now share request-scoped PostgreSQL locking and conditional state transitions. The newly added PostgreSQL integration tests must pass before this is considered verified.
3. Notification delivery now recovers stale `SENDING` claims, retries with bounded backoff, persists Expo tickets, polls receipts, and removes invalid device tokens. Operational metrics, alerts, and a durable outbox remain outstanding.
4. The approved PayGate payment workflow is documented but not implemented. Merchant capabilities and sandbox credentials are unconfirmed. Do not accept live payments or describe payment/settlement as production-ready.
5. Authentication still needs a shared production rate-limit store across replicas, a complete route-by-route authorization audit, and expanded replay/race tests.
6. Load, soak, worker crash/restart, multi-replica, provider outage, backup/restore, and staging recovery tests have not been demonstrated.

## Exit criteria

Production readiness is not declared until all P0 items are complete, the P1 items affecting the deployed architecture are complete, CI passes, PostgreSQL concurrency tests pass, and staging fault/load tests demonstrate recovery. A successful normal user journey alone is not sufficient.
