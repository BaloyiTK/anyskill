# Account, authentication and identity verification

**Status:** Initial implementation foundation. Identity-verification vendor and operating model remain undecided.

## Account registration

- A single AnySkill account can use Skill Seeker Mode and Skill Provider Mode.
- Registration collects an email address and password; phone is optional in this initial API contract.
- Passwords are hashed with Argon2id before storage.
- Email addresses are normalized to lowercase.
- Email verification is required before login.
- Email verification is separate from identity verification.

## Authentication

- Short-lived signed access tokens are used for API authentication.
- Refresh tokens are opaque, random, rotated on use and stored only as hashes.
- Logout revokes the refresh session.
- Password reset tokens are random, single-use, short-lived and stored only as hashes.
- Authentication endpoints must be rate-limited at the API gateway and application layer before production.

## Identity verification

- Every Skill Seeker and Skill Provider must complete identity verification before marketplace access.
- The initial API supports submitting a verification case and checking its status.
- The identity provider is not selected; no provider-specific SDK or API is assumed.
- A provider reference can be stored without storing identity document images in the application database.
- Only an authorized verification process may change a user to VERIFIED. The initial submission endpoint cannot approve a user.
- Manual review/admin decision endpoints are not yet implemented.
- Marketplace endpoints must use the server-side identity access guard/policy before they are introduced.

## Important distinction

Email verification proves control of an email inbox. It does not prove a person's legal identity. A submitted verification case is not an approved identity check.

## Production requirements still outstanding

- Select and contract with a compliant identity-verification provider.
- Decide supported countries, evidence types and age requirements.
- Implement administrator roles, audit logs and review decisions.
- Add rate limiting, abuse monitoring and account recovery controls.
- Configure production SMTP and deep links.
- Define POPIA-aligned purpose, retention, deletion and access policies.
- Add automated tests for registration races, token reuse, refresh rotation and verification access control.
