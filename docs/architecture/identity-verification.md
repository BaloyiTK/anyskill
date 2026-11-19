# Identity verification foundation

**Policy reference:** TS-001  
**Status:** Approved product requirement; provider and operating process are undecided.

## Mandatory rule

Every Skill Seeker and every Skill Provider must complete identity verification before accessing AnySkill marketplace functionality.

An account may exist before verification is complete, but it must not be able to:
- Publish or submit a job request.
- Receive or accept marketplace job offers.
- Select a provider or enter a marketplace transaction.
- Start or participate in marketplace work.

The backend is the authorization authority. Client-side checks are for user experience only and must never grant access.

## Verification states

- `not_started`
- `pending`
- `verified`
- `failed`
- `requires_information`
- `under_review`
- `suspended`
- `revoked`

Only `verified` permits marketplace access. Suspension or revocation removes that access.

## Security requirements

- Do not expose identity evidence to other users.
- Keep identity evidence separate from ordinary job attachments.
- Restrict access to authorized verification and compliance personnel.
- Encrypt sensitive information in transit and at rest.
- Record verification decisions and administrative access in an audit trail.
- Apply purpose limitation, data minimization and defined retention/deletion rules.
- Prefer storing provider references and verification outcomes over retaining full identity documents when legally and operationally possible.

## Separate Provider-role approval

Identity verification is an account-level trust check and is shared when a user activates a second marketplace role. It does not grant Provider access by itself and does not prove professional competence. Provider access is a separate role that requires a submitted skills/portfolio application and manual approval by an authorised Provider Reviewer. An account may continue using another active role while its Provider application is pending, rejected or awaiting more information.

See [Dual marketplace roles and Provider approval](dual-marketplace-roles.md) for the role lifecycle, switching rules and reviewer permissions.

## Not yet decided

1. Identity-verification provider and integration.
2. Accepted identity documents and supported countries.
3. Automated verification versus manual review.
4. Handling of mismatches, failed checks and appeals.
5. Re-verification triggers and expiry.
6. Data retention periods and lawful deletion process.
7. Age and legal-capacity requirements.
8. Business-account and representative verification.

## Implemented document-handling controls

The current implementation uses authenticated Cloudinary delivery for identity images and verifies the uploaded resource's owner reservation, purpose, format, size and authenticated delivery type before marking it ready.

The staff review queue returns document-availability flags only. It does not return Cloudinary URLs, storage keys or asset IDs. An Identity Reviewer must retrieve each image through a JWT-authenticated API route protected by the active staff-membership guard and the `IDENTITY_REVIEWER` permission. The API resolves the exact asset IDs recorded on the submitted verification case, verifies ownership, purpose and READY status, fetches the image server-side, checks its content type and byte length, and streams it with non-cacheable response headers. Individual document-view attempts are written to the staff audit log with the case and document purpose, never the document bytes or storage URL.

Identity preview links issued to the account owner are short-lived (60 seconds). They remain bearer links and must not be logged, copied into analytics, or exposed to other users. Staff review must use the authenticated proxy endpoint instead.

The admin portal requests reviewer images with the staff access token, holds them as in-memory browser object URLs, and revokes those URLs when the review modal closes or another review is opened.

## Production launch conditions still requiring operational sign-off

These are not safely provable by application code alone and must be completed before production identity-document collection:

1. Confirm Cloudinary account-level encryption at rest, backup encryption, region/data residency, access controls, breach notification commitments, and a signed POPIA-compliant operator/data-processing agreement.
2. Approve a documented retention schedule with South African privacy/legal advice. The schedule must cover approved, rejected, abandoned and appealed cases, backups, legal holds and deletion verification. Do not invent a retention period in code.
3. Verify production Cloudinary settings prevent public delivery and restrict credentials to the minimum required API permissions. Rotate credentials and store them only in the production secret manager.
4. Enforce MFA for every staff account with identity-review permissions and periodically review/revoke inactive reviewer memberships.
5. Run staging security tests for cross-account access, non-reviewer access, expired/closed cases, invalid purposes, tampered asset IDs, concurrent review decisions, storage outage behaviour and audit-log failure.
6. Complete an independent security review and POPIA impact assessment before collecting real identity documents.

Identity verification remains manual. No external identity-validation provider or automated authenticity check is implied by the upload and review workflow.
