# AnySkill Admin Portal

A lightweight, dependency-free web application for authorised AnySkill staff. It lives in the monorepo as `apps/admin` and uses the existing NestJS API.

## Run locally

1. Start the API using the repository instructions.
2. Ensure the API CORS allow-list includes the admin origin, normally `http://localhost:4173`.
3. From the repository root run:

```bash
pnpm --filter @anyskill/admin dev
```

4. Open `http://localhost:4173`.
5. Sign in with an existing staff account that has an active `PROVIDER_REVIEWER`, `ADMIN`, or `SUPER_ADMIN` membership.

The API base URL can be changed on the sign-in screen. Credentials are not stored by this app; access and refresh tokens are held in memory for the browser session and cleared on sign-out or failed refresh.

## Current live functionality

- Staff login through `POST /api/v1/auth/login`.
- Staff identity is loaded from `GET /api/v1/auth/me`.
- Access to the portal is verified by requesting `GET /api/v1/admin/provider-applications`; the API remains the authority for staff permissions.
- Provider application queue with pending and under-review filters.
- Start-review action, with audit logging performed by the API.
- Review skills, portfolio, qualifications and identity-verification status.
- Approve, reject or request information, with a required decision reason.
- Refresh-token renewal and sign-out.

## Current limitations

The overview displays live Provider application queue counts only. User management, identity case review, payments, disputes, fraud operations, staff provisioning and audit-log browsing are intentionally marked as planned modules until corresponding API endpoints and permission policies exist. No placeholder financial or user metrics are fabricated.

Provider approval is not identity verification. The portal displays the identity status returned by the API as a separate trust signal. Staff decisions are enforced and audited by the backend; hiding a UI control is never used as an authorization boundary.

## Deployment

Deploy `apps/admin` as a static site with the project root set to `apps/admin`. The static host must serve `index.html` for the root route. Configure the API's `CORS_ALLOWED_ORIGINS` to include the exact HTTPS admin origin. Configure the API base URL in the sign-in form to the deployed API URL.

Use HTTPS for both the portal and API in production. Restrict staff account creation and staff-role grants to controlled administrative operations. Do not expose database credentials or service secrets in this frontend.
