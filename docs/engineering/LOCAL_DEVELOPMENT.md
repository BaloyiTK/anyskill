# Local development runbook

## Database
Apply migrations in order:
1. database/migrations/001_marketplace_engine.sql
2. database/migrations/002_auth.sql
3. database/migrations/003_payments.sql
4. database/seeds/001_skills.sql

Do not assume these have been applied merely because they exist in GitHub.

## API
From server/: copy .env.example to .env, set DATABASE_URL and a long random JWT_SECRET, then run npm install and npm run typecheck. Start with npm run dev.

## Mobile
From repository root: copy .env.example to .env and set EXPO_PUBLIC_API_URL to an address reachable by the simulator/device. Run npm install, then npx expo start.

## Development verification
Professional accounts cannot go online until VERIFIED. After submitting verification, use database/dev/verify_professional.sql manually with the correct user UUID. This helper must not be exposed publicly.

## End-to-end smoke test
Register customer and professional accounts; create professional profile; select a seeded skill; save professional location; submit verification; manually approve in development; go online; customer searches that skill; send request; professional sends quote; customer accepts; advance booking through completion; customer confirms; create payment intent.

Payment settlement intentionally stops at PAYMENT_PROCESSING until a real provider with verified webhooks is integrated.
