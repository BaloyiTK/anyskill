# AnySkill Engineering Standards

> **Guiding principle:** Build it right, build it securely, build it to scale, and build it beautifully. Never trade engineering quality for short-term speed.

These standards apply to every application, API, package, infrastructure change, and contribution in this repository. They are the default engineering contract for contributors and AI coding agents. If a standard conflicts with an applicable law, platform requirement, or current official documentation, follow the higher-priority requirement and document the reason.

## 1. Documentation-first engineering

- Consult current official documentation for the exact framework, library, platform, and API version in use before introducing or changing an integration.
- Prefer supported, stable APIs. Do not invent APIs, rely on deprecated patterns, or assume behavior that has not been verified.
- Check compatibility, migration notes, security advisories, and breaking changes before upgrading dependencies.
- Treat repository architecture documents, API contracts, and existing conventions as part of the implementation specification.
- Record significant architectural choices, trade-offs, and operational procedures in `docs/`.
- When documentation is incomplete or contradictory, resolve the uncertainty before implementation and record the decision.

## 2. Architecture and platform boundaries

- Keep the system understandable and modular. Prefer the existing modular-monolith architecture; do not introduce microservices without a demonstrated scaling, reliability, or ownership need.
- Preserve clear module boundaries, dependency direction, and separation of concerns.
- Keep domain rules in the authoritative backend. Mobile clients must never be trusted to decide identity status, authorization, matching, pricing, approvals, or payment outcomes.
- Use versioned APIs and shared contracts where appropriate. Validate external and client input at system boundaries.
- Keep integrations behind replaceable adapters; isolate provider-specific behavior from domain logic.
- Mobile clients must communicate through APIs and must never connect directly to the database.
- Respect platform-specific client boundaries: React Native + Expo + TypeScript for iOS/Android/Huawei-compatible targets; HarmonyOS NEXT remains a separate native ArkTS + ArkUI client.
- Avoid circular dependencies, hidden cross-module side effects, and duplicated business logic.

## 3. Performance and high-traffic readiness

Design for horizontal scale and measure performance rather than making unsupported capacity claims.

- Make database access deliberate: select only required fields, avoid N+1 queries, use appropriate indexes, inspect query plans for expensive paths, and paginate potentially large result sets.
- Use bounded pagination and sensible request, payload, and upload limits. Do not return unbounded collections.
- Configure database connection pooling and timeouts for the deployment environment.
- Cache only where correctness permits; define TTLs, invalidation behavior, and ownership of cached data.
- Move long-running or retryable work out of request paths into durable background jobs/queues. Workers must support idempotency, retries with backoff, distributed-safe claiming, and dead-letter handling where appropriate.
- Ensure scheduled work and workers behave correctly with multiple application instances. Do not rely on process-local timers or in-memory state for distributed coordination.
- Apply rate limits, abuse controls, and backpressure to resource-intensive endpoints.
- Optimize media delivery with appropriate storage, image transformations, caching, and CDN delivery.
- Design stateless API instances where practical; make shared state explicit and use managed infrastructure for distributed coordination.
- Add observability for latency, throughput, error rates, queue depth, database saturation, and resource use.
- Validate performance with representative load, stress, and endurance tests. Set measurable service objectives before claiming production readiness.

## 4. Security, privacy, and trust

- Apply secure-by-default principles and the OWASP guidance relevant to the application and API.
- Enforce authentication and authorization on the backend for every protected operation, including object-level and role/mode checks. Never rely on hidden UI controls or client-supplied role/status fields.
- Use established password hashing, secure session/token handling, short-lived credentials where appropriate, rotation and revocation controls, and secure recovery flows.
- Protect browser sessions against XSS, CSRF, and token theft. Prefer appropriately configured HttpOnly, Secure, SameSite cookies for browser refresh sessions when the architecture supports them; never expose long-lived secrets to browser JavaScript.
- Validate and normalize all untrusted input on the server. Use parameterized database access and safe output handling.
- Apply least privilege to service accounts, database roles, API credentials, and infrastructure permissions.
- Store secrets in approved secret-management systems or environment configuration; never commit credentials, signing keys, private keys, tokens, or production data.
- Encrypt sensitive data in transit and at rest where supported. Minimize collection, access, and retention of personal data.
- Treat identity documents, precise location, payment details, and user-generated uploads as sensitive. Define access controls, retention, deletion, and audit requirements before enabling these workflows.
- Use secure upload validation, file size/type limits, malware scanning where appropriate, and private storage for sensitive files.
- Log security-relevant events without logging passwords, tokens, payment credentials, identity documents, or unnecessary personal data.
- Keep dependencies patched and run dependency, secret, and vulnerability checks in CI.
- Meet applicable privacy and legal obligations, including POPIA where applicable. Escalate uncertainty rather than assuming compliance.

## 5. Database and data integrity

- Make schema changes through reviewed, version-controlled migrations. Do not rely on undocumented manual production changes.
- Use appropriate constraints, foreign keys, indexes, and transaction boundaries to protect invariants.
- Use correct data types for money, coordinates, timestamps, and identifiers; avoid floating-point arithmetic for monetary values.
- Make concurrency-sensitive transitions atomic and safe under retries and duplicate requests.
- Design webhook and background-job processing to be idempotent and resilient to out-of-order or repeated delivery.
- Plan migrations for production-sized data, lock impact, rollback or forward-recovery strategy, and compatibility between deployed application versions.
- Define backup, restore, and disaster-recovery procedures and test restores regularly.

## 6. API and integration quality

- Keep API contracts explicit, versioned where needed, validated, and documented.
- Return consistent response and error shapes. Do not leak stack traces, secrets, internal identifiers, or sensitive implementation details to clients.
- Apply timeouts, bounded retries, circuit-breaking or equivalent failure isolation to external dependencies where appropriate.
- Verify third-party callbacks and webhooks cryptographically where supported; never trust an unverified callback as proof of payment or identity.
- Separate payment authorization, capture, refund, settlement, and reconciliation states. Record auditable state transitions and reconcile with the provider.
- Do not represent planned or unintegrated provider functionality as production-ready.

## 7. UI/UX and accessibility

- Build a cohesive, modern product experience using shared design tokens and reusable components for color, typography, spacing, elevation, and interaction states.
- Prioritize clear hierarchy, readable typography, consistent spacing, responsive layouts, and purposeful motion.
- Every meaningful screen and asynchronous action must handle loading, empty, error, success, disabled, and retry states as applicable.
- Make forms understandable and accessible: labels, validation feedback, keyboard behavior, focus handling, and appropriate input types.
- Support accessibility features such as screen-reader semantics, adequate contrast, scalable text, and touch targets that meet platform guidance.
- Avoid clutter, inconsistent patterns, gratuitous animation, and UI that hides important status or actions.
- Keep animations and rendering performant on supported devices; respect reduced-motion preferences where available.
- Test important flows on representative screen sizes and real devices/simulators, not only in one development viewport.

## 8. Code quality and maintainability

- Use strict TypeScript and preserve type safety across app, API, and shared packages. Avoid `any`; if unavoidable, isolate it and document why.
- Prefer small, cohesive functions and components with clear names and explicit responsibilities.
- Keep business logic out of presentation components and transport/controller layers.
- Handle errors intentionally; do not swallow exceptions or use empty catch blocks.
- Avoid dead code, duplicated rules, unexplained magic numbers, hidden global state, and hardcoded environment-specific values.
- Follow the repository's formatting, linting, naming, and file-organization conventions.
- Add comments to explain non-obvious reasoning and constraints, not to narrate obvious code.
- Keep dependencies minimal. Justify new dependencies by capability, maintenance health, security, and bundle/runtime cost.

## 9. Testing and verification

Tests are part of the feature, not optional follow-up work.

- Add or update unit tests for domain logic and edge cases.
- Add integration tests for database behavior, API boundaries, authorization, and external-provider adapters.
- Add end-to-end tests for critical user journeys and cross-module workflows.
- Test negative paths: unauthenticated access, forbidden access, invalid input, duplicate requests, concurrency, retries, timeouts, and provider failures.
- Test migrations and important queries against a representative database setup.
- Add accessibility and UI-state coverage for critical mobile flows.
- Run the relevant checks before considering work complete: formatting, lint, typecheck, unit tests, integration tests, end-to-end tests, security checks, and production builds.
- Add performance/load tests for changes affecting hot paths, matching, search, queues, payments, or other high-volume operations.
- Never claim a check passed unless it was actually run and passed. Clearly report checks that could not be run and why.
- Do not merge knowingly broken functionality or disable a failing check merely to make CI green.

## 10. CI/CD and operations

- Keep CI reproducible: use the committed lockfile and frozen dependency installation in automated builds.
- Run required checks on every pull request and on the protected release branches. Branch filters must match the repository's actual workflow.
- Maintain separate development, staging, and production configuration; never reuse production secrets in lower environments.
- Automate safe database migrations and deployment verification.
- Provide health and readiness checks that reflect critical dependencies without exposing sensitive internals.
- Centralize structured logs, metrics, and traces; redact sensitive values and establish actionable alerts.
- Define deployment rollback and incident-response procedures. Prefer backward-compatible, low-downtime releases where feasible.
- Document operational ownership, backup schedules, restore steps, and critical third-party dependencies.

## 11. Required change workflow

For every non-trivial change:

1. Inspect the current implementation, repository conventions, and relevant documentation before editing.
2. Identify the root cause or user need; do not patch symptoms blindly.
3. Map affected modules, API contracts, data models, security boundaries, and platform targets.
4. Choose the smallest robust change that preserves compatibility and maintainability.
5. Implement tests and documentation alongside the change.
6. Review the result for correctness, security, privacy, performance, accessibility, and user experience.
7. Run relevant checks and inspect the final diff for accidental changes, secrets, and generated noise.
8. Summarize what changed, important trade-offs, checks run, and any remaining risks.

If a requirement cannot be met, state the reason, the risk, and a concrete follow-up. Do not silently lower the standard.

## 12. Definition of done

A feature or fix is complete only when all applicable items are satisfied:

- [ ] It follows current official documentation and repository architecture.
- [ ] Types, contracts, and module boundaries are correct and maintainable.
- [ ] Backend authorization and input validation are enforced.
- [ ] Privacy, secrets, and sensitive-data handling have been reviewed.
- [ ] Database integrity, query performance, and migration safety have been considered.
- [ ] UI is consistent, accessible, responsive, and handles loading/empty/error/success states.
- [ ] Relevant unit, integration, and end-to-end tests are added or updated.
- [ ] Formatting, lint, typecheck, and production build pass.
- [ ] Security and performance implications have been checked; benchmarks are added when warranted.
- [ ] Documentation and operational guidance are updated where needed.
- [ ] The final diff contains no credentials, production data, debug leftovers, or unrelated changes.
- [ ] Any uncompleted checks or accepted risks are explicitly reported.

---

**Engineering bar:** Optimize for the long-term health of AnySkill. Build it right, securely, to scale, and beautifully.
