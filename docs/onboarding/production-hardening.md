# Onboarding production-hardening checklist

## Implemented API controls

- All onboarding routes require an authenticated JWT.
- The global validation pipe rejects unknown top-level DTO properties and does not implicitly coerce values.
- Onboarding saves are limited to 20 requests per minute per client; submissions are limited to 5 per minute.
- Draft payloads must contain at least one supported section and are capped at 50 KB.
- Profile fields use an explicit allowlist; role values, contact formats, and field lengths are checked.
- Skills, qualifications, and portfolio entries have explicit nested-field allowlists and collection limits.
- Duplicate skill categories are rejected after case normalization.
- External portfolio, qualification, and profile-photo references must be public HTTPS URLs without embedded credentials or obvious local/private hosts.
- Draft save and submission operations serialize on the provider-eligibility advisory lock.
- Submission detects a draft changed after it was read and returns a conflict instead of submitting stale data.
- Draft saves do not create provider-review queue records. Provider skills and applications enter review only on explicit submission.
- Provider approval remains a manual review decision.

## Required staging verification before production sign-off

Run these checks against a disposable staging account and real mobile builds:

1. Register as a Seeker, save each profile section, close/reopen the app, and confirm the draft is restored exactly.
2. Register as a Provider, save skills and portfolio, restart the app, and confirm all entries and attachments remain intact.
3. Submit an incomplete profile and confirm a clear 400 response with no role/application state changes.
4. Submit a complete Provider profile and confirm exactly one pending provider application and one pending review record per new skill.
5. Save a draft repeatedly without submitting; confirm no provider application or skill-review records are created.
6. Submit twice rapidly and from two app sessions; confirm no duplicate application or duplicate submission notification.
7. Race a draft save against submission; confirm the submission either uses the latest complete draft or returns a conflict requiring refresh.
8. Attempt unknown fields at the profile, skill, qualification, portfolio, and top-level DTO levels; confirm rejection.
9. Attempt oversized payloads, excessive array entries, duplicate skills, malformed email/phone values, non-HTTPS URLs, credential-bearing URLs, and localhost/private-network URLs; confirm rejection.
10. Verify that qualification and portfolio attachments are actually uploaded and readable by their owner after sign-in; test deleted, expired, and another user's references.
11. Confirm rate limits work across multiple API replicas using the configured shared throttling storage; verify the configured fail-open/fail-closed behaviour.
12. Verify role changes, rejected skill resubmissions, suspended users, and existing approved skills are preserved correctly.
13. Confirm logs and API errors do not expose identity documents, attachment URLs, email addresses, or submitted profile values.
14. Run the complete CI suite and a mobile end-to-end test on supported Android and iOS versions.

## Sign-off boundary

Code-level validation does not prove ownership or availability of arbitrary attachment URLs, nor does it prove mobile lifecycle behaviour or multi-replica rate limiting. Those checks must pass in staging before onboarding is described as production-ready.
