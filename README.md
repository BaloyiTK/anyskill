# AnySkill

AnySkill is a real-time skills marketplace connecting **Skill Seekers** with **Skill Providers**.

The mobile product is one application with two operating modes. A single account can use both Skill Seeker Mode and Skill Provider Mode.

## Platform targets

- iOS, Android and Huawei Android-compatible devices: React Native + Expo + TypeScript.
- HarmonyOS NEXT: a separate native client using ArkTS + ArkUI. It is not part of the React Native build.

## Repository structure

- `apps/mobile`: React Native + Expo application.
- `apps/api`: NestJS backend.
- `apps/api/prisma`: PostgreSQL schema and migrations.
- `packages/contracts`: shared TypeScript domain contracts.
- `docs/architecture`: architecture decisions and specifications.

## Prerequisites

- Node.js 22.22.3 or newer.
- pnpm 10 or newer.
- Docker Desktop or Docker Engine with Compose.
- Xcode for local iOS builds on macOS.
- Android Studio for Android builds.

## Start local services

```bash
docker compose up -d postgres
```

## API and worker setup

1. Copy `apps/api/.env.example` to `apps/api/.env`.
2. Generate a unique `JWT_ACCESS_SECRET` of at least 32 characters.
3. Configure a SMTP provider in `apps/api/.env` if email delivery is required.
4. Install dependencies, generate Prisma Client and apply migrations.
5. Run the HTTP API and the marketplace worker as two separate long-running processes. The worker is required for Provider incoming-request push notifications, notification delivery/retries and other background marketplace tasks.

```bash
corepack enable
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm dev:api
```

Open a **second terminal** in the repository and start the worker:

```bash
pnpm dev:worker
```

The worker command sets `ANYSKILL_PROCESS_ROLE=worker` for the worker process and starts the dedicated Nest worker entrypoint in watch mode. It polls persisted marketplace work every 15 seconds. Do not set this role on the HTTP API process.

The API health endpoint is `http://localhost:3000/api/v1/health`.

### Production process configuration

Deploy the HTTP API and marketplace worker as **separate always-on processes/services** from the same built API artifact and with the same required database and application environment. Configure the API process to run `pnpm --filter @anyskill/api start:prod`. Configure the worker process to run `pnpm start:worker`; this command sets `ANYSKILL_PROCESS_ROLE=worker` before launching `dist/worker.js`. The worker must remain running and restart automatically on process failure. Do not run multiple worker replicas unless the worker's shared database lock and operational capacity have been deliberately validated.

The worker must pass its own production configuration validation at startup. A healthy HTTP API by itself does not mean marketplace push notifications are being processed; monitor the worker's startup log and marketplace worker heartbeat.

## Mobile setup

Copy `apps/mobile/.env.example` to `apps/mobile/.env`. Change `EXPO_PUBLIC_API_URL` to your computer's LAN address when testing on a physical device.

```bash
pnpm dev:mobile
```

## Account and identity policy

- A single account can use both Skill Seeker and Skill Provider modes.
- Email verification is required before login.
- Skill Seekers must be verified before publishing a service request. Skill Providers may view incoming requests while unverified, but must be verified before responding/accepting.
- Email verification is not identity verification.
- The API creates and tracks identity-verification cases, but no identity provider or approval process has been selected or integrated yet.
- Never mark a user verified from a mobile client or an untrusted request.

See `docs/architecture/account-and-verification-workflow.md` for the API contract and implementation boundaries.

## Payments

The approved payment direction is saved-card tokenisation during Skill Seeker profile setup, card pre-authorisation after the Seeker approves the job estimate and before work starts, and payment capture only after the Seeker approves the Provider's completed work. Provider settlement is a separate platform process. See `docs/architecture/payment-and-settlement-workflow.md`. PayGate saved-card, authorisation, capture and settlement capabilities still require merchant-account confirmation; payment processing is not yet implemented.

## Engineering principles

- The backend is authoritative for identity, permissions, matching, pricing, approvals and payments.
- Mobile clients communicate with versioned APIs; they do not connect directly to the database.
- External providers are accessed through replaceable adapters.
- Start with a modular monolith and preserve module boundaries.
- Never commit credentials, signing keys, identity documents or production personal data.
