# Account, authentication and identity verification

**Status:** API foundation implemented. Provider integration and operational review process remain undecided.

## Account registration

- A single AnySkill account can use Skill Seeker Mode and Skill Provider Mode.
- Registration collects an email address and password; phone is optional in the initial API contract.
- Passwords are hashed with Argon2id before storage.
- Email addresses are normalized to lowercase.
- Email verification is required before login.
- Email verification is separate from identity verification.

## Authentication

- Short-lived signed access tokens are used for API authentication.
- Refresh tokens are opaque, random, rotated on use and stored only as hashes.
- Logout revokes the refresh session.
- Password reset tokens are random, single-use, short-lived and stored only as hashes.
- Validation rejects unexpected request fields.
- Production deployment must add rate limits, abuse monitoring, TLS, secret management and operational alerting.

## Identity verification

- Every Skill Seeker and Skill Provider must complete identity verification before marketplace access.
- The API supports submitting a verification case and checking its status.
- The identity provider is not selected; no provider-specific SDK or API is assumed.
- User clients cannot set a provider reference or approve themselves.
- The submission endpoint only creates a pending case; it cannot mark a user verified.
- Suspended and revoked accounts cannot submit a new case through the ordinary user endpoint.
- A user already verified cannot accidentally downgrade their status by submitting again.
- Marketplace endpoints must use both JWT authentication and `MarketplaceAccessGuard`.

## Important distinction

Email verification proves control of an email inbox. It does not prove a person's legal identity. A submitted verification case is not an approved identity check.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/auth/register` | Create account and send email verification |
| POST | `/api/v1/auth/login` | Sign in after email verification |
| POST | `/api/v1/auth/verify-email` | Consume email verification token |
| POST | `/api/v1/auth/refresh` | Rotate refresh token |
| POST | `/api/v1/auth/logout` | Revoke refresh session |
| POST | `/api/v1/auth/forgot-password` | Request password reset |
| POST | `/api/v1/auth/reset-password` | Set a new password |
| GET | `/api/v1/auth/me` | Return authenticated account summary |
| GET | `/api/v1/identity-verification/status` | Read identity-verification status |
| POST | `/api/v1/identity-verification/submit` | Create a verification case |

## Production requirements still outstanding

- Select and contract with a compliant identity-verification provider.
- Implement provider session creation, callback/webhook signature validation and result reconciliation.
- Implement administrator roles, audit logs and any manual review workflow.
- Decide supported countries, evidence types and age requirements.
- Add rate limiting, abuse monitoring and account recovery controls.
- Configure production SMTP and deep links.
- Define POPIA-aligned purpose, retention, deletion and access policies.
- Add automated tests for registration races, token reuse, refresh rotation and verification access control.
- Add an outbox/retry mechanism so email delivery failures do not strand new accounts.
