# AnySkill platform baseline

## Approved product decisions

- One mobile application with Skill Seeker and Skill Provider modes.
- One account can use both modes.
- Skill Seekers choose from provider offers.
- Hybrid Smart Matching expands to more suitable providers when early matching does not produce sufficient responses.
- Both Skill Seekers and Skill Providers must complete identity verification before consequential marketplace actions, with action-specific gates (TS-001).
- Skill Seeker card details are collected during profile setup through a PayGate-hosted/tokenised card flow; AnySkill must not store raw card numbers or CVV.
- The approved payment lifecycle is pre-authorisation after estimate approval and before work starts, capture only after Seeker approval of completed work, then separate Provider settlement.

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
3. Identity verification is mandatory for both roles at consequential actions; read-only browsing and receiving incoming requests are not blanket-blocked.
4. External providers are accessed through replaceable adapters.
5. Begin with a modular monolith; extract services only when justified.
6. Keep shared contracts independent of client-specific UI.
7. Payment credentials and raw card data must remain with the PCI-compliant gateway; store only gateway customer/payment-method references and masked display metadata.
8. Treat authorisation, capture, refund/void and Provider settlement as distinct, auditable financial events. Never trust a mobile redirect as proof of payment.

## Current scaffold scope

The repository currently includes the initial mobile/API foundation, authentication and identity-verification workflow foundations, marketplace requests, matching/notifications, offer selection, job assessment/cost approval, completion approval and Cloudinary evidence upload code. Identity-provider operations, production push credentials, Cloudinary live configuration/device verification, payment processing, production-grade background workers, messaging beyond notifications and administration remain incomplete. See the individual architecture documents for implementation status.
