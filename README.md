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
- PostgreSQL 15 or newer.
- Xcode for local iOS builds on macOS.
- Android Studio for Android builds.

## API setup

1. Copy `apps/api/.env.example` to `apps/api/.env`.
2. Set `DATABASE_URL`, a unique `JWT_ACCESS_SECRET` and SMTP credentials.
3. Install dependencies and generate the Prisma client.
4. Apply the database migrations.
5. Start the API.

```bash
corepack enable
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm dev:api
```

The API health endpoint is `http://localhost:3000/api/v1/health`.

## Mobile setup

```bash
pnpm dev:mobile
```

## Account and identity policy

- A single account can use both Skill Seeker and Skill Provider modes.
- Email verification is required before login.
- Both user roles must complete identity verification before marketplace access.
- Email verification is not identity verification.
- The API creates and tracks identity-verification cases, but no identity provider has been selected or integrated yet.
- Never mark a user verified from a mobile client or from an untrusted request.

See `docs/architecture/account-and-verification-workflow.md` for the API contract and implementation boundaries.

## Engineering principles

- The backend is authoritative for identity, permissions, matching, pricing, approvals and payments.
- Mobile clients communicate with versioned APIs; they do not connect directly to the database.
- External providers are accessed through replaceable adapters.
- Start with a modular monolith and preserve module boundaries.
- Never commit credentials, signing keys, identity documents or production personal data.
