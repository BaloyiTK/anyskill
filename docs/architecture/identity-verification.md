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

## Not yet decided

1. Identity-verification provider and integration.
2. Accepted identity documents and supported countries.
3. Automated verification versus manual review.
4. Handling of mismatches, failed checks and appeals.
5. Re-verification triggers and expiry.
6. Data retention periods and lawful deletion process.
7. Age and legal-capacity requirements.
8. Business-account and representative verification.

## Implementation boundary

The initial codebase contains shared verification-state contracts and a server-side policy function. It does not yet authenticate users, collect identity documents, call a verification provider, or authorize marketplace endpoints. Those features must be implemented with persistent records, authentication, audit logging and security review before marketplace launch.
