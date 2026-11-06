# AnySkill

AnySkill is a real-time skills marketplace connecting **Skill Seekers** with **Skill Providers**.

The mobile product is one application with two operating modes. A single account can use both Skill Seeker Mode and Skill Provider Mode.

## Platform targets

- iOS, Android and Huawei Android-compatible devices: React Native + Expo + TypeScript.
- HarmonyOS NEXT: a separate native client using ArkTS + ArkUI. It is not part of the React Native build.

## Repository structure

- `apps/mobile`: React Native + Expo application.
- `apps/api`: NestJS backend.
- `packages/contracts`: shared TypeScript domain contracts.
- `docs/architecture`: architecture decisions and specifications.

## Prerequisites

- Node.js 22.22.3 or newer.
- pnpm 10 or newer.
- Xcode for local iOS builds on macOS.
- Android Studio for Android builds.

## Getting started

```bash
corepack enable
pnpm install
pnpm dev:mobile
```

In another terminal:

```bash
pnpm dev:api
```

The API health endpoint is `http://localhost:3000/api/v1/health`.

## Current implementation status

This is the initial foundation scaffold. It establishes the workspace, mobile application shell, backend application shell and shared identity-verification contracts.

**Marketplace access policy:** both Skill Seekers and Skill Providers must complete identity verification before using marketplace functionality. The backend must enforce this policy. A mobile UI check is never an authorization boundary.

The identity-verification provider, evidence requirements, manual review process and retention periods have not yet been selected.

## Engineering principles

- The backend is authoritative for identity, permissions, matching, pricing, approvals and payments.
- Mobile clients communicate with versioned APIs; they do not connect directly to the database.
- PostgreSQL/PostGIS, Redis, real-time transport, object storage and external integrations will be introduced behind clear interfaces.
- Start with a modular monolith and preserve module boundaries.
- Never commit credentials, signing keys, identity documents or production personal data.
