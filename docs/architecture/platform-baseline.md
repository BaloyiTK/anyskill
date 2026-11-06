# AnySkill platform baseline

## Approved product decisions

- One mobile application with Skill Seeker and Skill Provider modes.
- One account can use both modes.
- Skill Seekers choose from provider offers.
- Hybrid Smart Matching expands to more suitable providers when early matching does not produce sufficient responses.
- Both Skill Seekers and Skill Providers must complete identity verification before marketplace access (TS-001).

## Target clients

- React Native + Expo + TypeScript for iOS, Android and Huawei Android-compatible devices.
- Separate native HarmonyOS NEXT client using ArkTS + ArkUI.

## Backend direction

- NestJS + TypeScript modular monolith.
- PostgreSQL as the primary relational database.
- PostGIS for geographic queries.
- Redis for caching, presence and background queues.
- WebSockets for real-time updates.
- Object storage for job and completion media.
- Versioned REST APIs.

## Architecture rules

1. Mobile applications do not connect directly to the database.
2. The backend owns authorization and all critical marketplace rules.
3. Identity verification is mandatory for every user role before marketplace access.
4. External providers are accessed through replaceable adapters.
5. Begin with a modular monolith; extract services only when justified.
6. Keep shared contracts independent of client-specific UI.

## Current scaffold scope

The repository currently contains the mobile shell, API shell, shared identity contracts and architecture notes. Database integration, authentication, identity-provider integration, payment processing, matching, messaging and administration have not yet been implemented.
