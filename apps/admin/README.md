# AnySkill Admin Portal

A lightweight, dependency-free web application for authorised AnySkill staff. It lives in the monorepo as `apps/admin` and uses the existing NestJS API.

## Run locally

1. Start the API.
2. Start the Admin Portal from the repository root:

```bash
pnpm --filter @anyskill/admin dev
```

3. Open `http://localhost:4173`.
4. Sign in with an existing AnySkill staff account.

The API base URL can be changed on the sign-in screen. Credentials are not stored by this app; access and refresh tokens are held in memory for the browser session and cleared on sign-out or failed refresh.

For local development, the API preserves configured `CORS_ALLOWED_ORIGINS` entries and also allows `http://localhost:4173` and `http://127.0.0.1:4173`. Production uses only the explicitly configured allow-list, which must contain the deployed Admin Portal origin.

## Live administration functionality

- Staff login through `POST /api/v1/auth/login` and staff identity through `GET /api/v1/auth/me`.
- Identity verification queue with ID-document and selfie previews.
- Separate identity approval or rejection. Rejection requires a reason.
- Individual Provider skill review queue with independent approval or rejection. Rejection requires a reason; skill approval is disabled until identity is verified and is also enforced by the API.
- Accounts register showing Seeker/Provider modes, identity status, and each skill's status and decision reason.
- Provider access is displayed as derived from verified identity plus at least one approved skill. There is no separate Provider approval action.
- Permission-aware navigation for Identity Reviewer, Skills Reviewer, Administrator and Super Administrator.
- Super Administrator staff management.
- Dashboard marketplace and job-lifecycle metrics, including assessment, estimate, completion, dispute, payment and payout states.
- Read-only operational job register (latest 250 engagements), with lifecycle timestamps, approved job amount, separate payment and payout states, financial transaction records, disputes and reciprocal rating completion.
- Ratings view based on the two separate job-review records.
- Account register visibility of the separate Seeker and Provider role statuses.
- Refresh-token renewal and sign-out.

A dual-mode account retains Seeker access independently of Provider identity and skill review outcomes. Skills added later are reviewed individually; existing skill decisions are not combined into a new whole-account approval.

## Retired workflow

Whole-Provider application approval is retired. The old Provider applications queue and combined approve/reject/request-information workflow are not part of the Admin Portal.

## Deployment

Deploy `apps/admin` as a static site with the project root set to `apps/admin`. The static host must serve `index.html` for the root route. Configure the API base URL in the sign-in form to the deployed API URL and set the API's `CORS_ALLOWED_ORIGINS` to the exact HTTPS Admin Portal origin.

Use HTTPS for both the portal and API in production. Restrict staff account creation and staff-role grants to controlled administrative operations. Do not expose database credentials or service secrets in this frontend.

 
## Operational data definitions

- **Completed job value** is the sum of approved final job amounts for completed engagements. It is not a successful debit, cash received, platform revenue or Provider bank payout.
- **Successful PayFast payments** count engagements whose payment state is confirmed as `PAYFAST_PAID`. Simulated payments remain separately identified.
- **Provider payouts pending** counts payout obligations with a pending status. A successful Seeker debit does not prove that a bank transfer has completed.
- **Ratings outstanding** counts completed jobs where at least one reciprocal Provider/Seeker review is missing.
- The job register is read-only and returns at most the latest 250 engagements. Financial transaction rows retain their recorded mode and status, including simulated records.
