# Account, authentication and identity verification

**Status:** Account/authentication foundation implemented. Identity provider integration and operational review process remain undecided.

## Account registration

- A single AnySkill account can use Skill Seeker Mode and Skill Provider Mode.
- Registration collects an email address and password; phone is optional in the initial API contract.
- Passwords are hashed with Argon2id before storage.
- Email addresses are normalized to lowercase.
- Email verification is required before login.
- Email verification is separate from identity verification.

## Authentication

- Signed access tokens expire after 15 minutes.
- Opaque refresh tokens expire after 30 days, rotate on use and are stored only as SHA-256 hashes.
- Logout revokes the refresh session; password reset revokes all active refresh sessions.
- Passwords are hashed with Argon2id. Email verification tokens expire after 24 hours; password reset tokens expire after 30 minutes. Both are single-use and stored only as hashes.
- Validation rejects unexpected request fields.
- Auth routes have per-IP throttles and the API has a global in-memory request limit. Production must use shared rate-limit storage (for multiple API instances), add account-based throttles, abuse monitoring, TLS, secret management and operational alerting.
- The mobile app stores access and refresh tokens using Expo SecureStore rather than ordinary application storage.

## Google sign-in

- Mobile sign-in uses Expo AuthSession to obtain a Google OpenID Connect ID token.
- The API verifies the token signature, issuer, expiry and audience using Google's supported Node.js authentication library. Only configured OAuth client IDs are accepted.
- A new Google account is created with the Google-verified email already marked as verified. It still starts with identity verification set to `NOT_STARTED`.
- Existing AnySkill accounts are never silently linked just because the email addresses match. The user signs in to the existing account first, then explicitly connects Google from the authenticated account screen. The Google email must match the AnySkill account email.
- A Google identity can only be linked to one AnySkill account.
- Google sign-in issues the same AnySkill access and refresh tokens as password sign-in. Google tokens are not used as AnySkill API access tokens.
- Google OAuth client IDs are public identifiers and are configured per mobile platform. No Google client secret is embedded in the mobile app.
- Huawei Android-compatible devices use the browser-based OAuth flow; availability depends on the device being able to reach Google's sign-in service. Native HarmonyOS NEXT remains a separate client integration.

## Identity verification and action gates

Identity verification is mandatory for both Skill Seekers and Skill Providers, but it is **not a blanket gate on viewing the marketplace or receiving a job request**. It is enforced when a user attempts a consequential action:

1. **Skill Seeker request submission:** A Skill Seeker must have identity status `VERIFIED` before submitting a service request. They may browse and prepare a request beforehand, but cannot publish/submit it until verified.
2. **Skill Provider incoming requests:** A Skill Provider may receive notifications and view incoming requests while unverified. This preserves the opportunity to review available work.
3. **Skill Provider acceptance:** When an unverified provider taps Accept, AnySkill must pause acceptance and show a clear identity-verification prompt. The provider must complete verification and reach `VERIFIED` status before acceptance can be submitted. After verification, they can return to the request and accept it if it is still available.
4. **Other marketplace actions:** Apply the relevant action-specific policy. Do not apply a blanket identity guard to read-only marketplace routes or incoming-request delivery.

The API must enforce these rules server-side; hiding or disabling a mobile button is not sufficient. The seeker-request creation endpoint and provider-accept endpoint must each check the authenticated user's current verification status immediately before performing the action. The provider acceptance must re-check that the request is still available after the verification flow.

- The API supports submitting a verification case and checking its status.
- The identity provider is not selected; no provider-specific SDK or API is assumed.
- User clients cannot set a provider reference or approve themselves.
- The submission endpoint only creates a pending case; it cannot mark a user verified.
- Suspended and revoked accounts cannot submit a new case through the ordinary user endpoint.
- Verification status must be read from trusted server-side records, not accepted from the client.

## Verification experience

- Explain the requirement at the point it matters: before a Seeker submits a request, and when a Provider tries to accept an incoming request.
- Tell the user why verification is needed, what the next step is, and whether their current verification is pending, needs more information, failed, suspended or verified.
- Preserve the provider's incoming request context during verification and provide a return-to-request path.
- Do not imply that submitting a verification case means the identity has been approved.

## Important distinction

Email verification proves control of an email inbox. It does not prove a person's legal identity. A submitted identity-verification case is not an approved identity check.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/auth/register` | Create account and send email verification |
| POST | `/api/v1/auth/login` | Sign in after email verification |
| POST | `/api/v1/auth/google` | Verify Google ID token and sign in or create account |
| POST | `/api/v1/auth/google/link` | Link Google to the currently authenticated account |
| POST | `/api/v1/auth/verify-email` | Consume email verification token |
| POST | `/api/v1/auth/resend-verification` | Resend email verification link |
| POST | `/api/v1/auth/refresh` | Rotate refresh token |
| POST | `/api/v1/auth/logout` | Revoke refresh session |
| POST | `/api/v1/auth/forgot-password` | Request password reset |
| POST | `/api/v1/auth/reset-password` | Set a new password |
| GET | `/api/v1/auth/me` | Return authenticated account summary |
| GET | `/api/v1/identity-verification/status` | Read identity-verification status |
| POST | `/api/v1/identity-verification/submit` | Create a verification case |
| POST | `/api/v1/marketplace/requests` | Submit a service request (verified Seeker only) |
| GET | `/api/v1/marketplace/incoming-requests` | View open requests (unverified Providers may view) |
| GET | `/api/v1/marketplace/my-requests` | View the Seeker's own requests and Provider responses |
| POST | `/api/v1/marketplace/requests/:requestId/accept` | Send a Provider offer (verified Provider only; does not award job) |

## Local development

- PostgreSQL and Mailpit are available through the repository Docker Compose file.
- Mailpit captures verification and password-reset messages at `http://localhost:8025`.
- Mailpit is development-only. Production must use a real SMTP provider and verified sender domain.

## Implementation gaps and production requirements

- Marketplace API foundation is implemented: verified Seekers can publish service requests; Providers can read open incoming requests while unverified; verified Providers can respond through the Accept action. The response is an offer/interest record and does not award the job—the Seeker still chooses a Provider. The mobile request form and incoming-request feed are now implemented. This first feed lists open requests; it is not yet the Smart Matching engine and does not send push notifications. Provider matching/notification delivery, request cancellation/closing, and the Seeker's offer-selection flow remain to be built.
- Phone number is optional in the current registration API, and SMS/phone OTP verification is not implemented. If mobile verification remains a mandatory product rule, it must be implemented and enforced before marketplace launch.
- Select and contract with a compliant identity-verification provider.
- Implement provider session creation, callback/webhook signature validation and result reconciliation.
- Implement administrator roles, audit logs and any manual review workflow.
- Decide supported countries, evidence types and age requirements.
- Add rate limiting, abuse monitoring and account recovery controls.
- Configure production SMTP and deep links.
- Define POPIA-aligned purpose, retention, deletion and access policies.
- Add automated tests for registration races, token reuse, refresh rotation and action-specific verification access control.
- Add an outbox/retry mechanism so email delivery failures do not strand new accounts.
