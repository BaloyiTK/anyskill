# AnySkill Engineering Specification

**Status:** Engineering baseline  
**Product:** AnySkill — local, on-demand skills marketplace  
**MVP principle:** Find the skill. Get it done.

## 1. Objective

AnySkill connects customers who need work done with nearby, available professionals. The MVP must prove one marketplace loop:

> A verified professional configures a skill, service area and availability; a customer discovers that professional by skill and radius; the customer sends a job request; the professional accepts, declines or quotes; both parties progress the job to completion, payment and review.

The architecture must support local instant work first while leaving room for scheduled and remote work later.

## 2. Engineering Principles

1. **Mobile first:** one React Native codebase for iOS and Android.
2. **Marketplace state is server-authoritative:** clients request transitions; they do not directly decide job/payment state.
3. **PostgreSQL/PostGIS is the source of truth** for marketplace and geospatial data.
4. **Privacy by design:** exact professional/customer coordinates are not exposed during public discovery.
5. **Least privilege:** database Row Level Security (RLS), short-lived authenticated sessions, privileged mutations server-side.
6. **Vertical delivery:** build complete marketplace slices rather than 25 disconnected screens.
7. **Idempotency:** requests involving bookings, payments, payouts and notifications must tolerate retries.
8. **Auditability:** important state changes are appended to history/audit tables.
9. **Money is integer minor units:** e.g. ZAR 400.00 is stored as 40000 cents, never floating point.
10. **UTC internally:** persist timestamps in UTC and localize in the app.

## 3. Recommended MVP Stack

### Mobile
- React Native
- Expo
- TypeScript
- Expo Router
- TanStack Query for server state
- Zod for boundary validation
- React Hook Form for forms
- Expo SecureStore for sensitive device tokens
- Expo Notifications for push integration

### Backend
- Supabase-hosted PostgreSQL
- PostGIS
- Supabase Auth
- Supabase Realtime
- Supabase Storage
- Edge/server functions for privileged business operations

The mobile app may read authorized data through RLS-backed queries. Sensitive writes—matching, state transitions, quotes, payments, payouts, verification and privileged notifications—go through server functions.

### External adapters
Keep mapping, payments, identity verification and messaging/push behind provider interfaces. Provider selection can change without changing marketplace domain models.

## 4. High-Level Architecture

```text
React Native / Expo
        |
        +---- Auth session
        |
        v
Application services / server functions
        |
   +----+----------------+----------------+
   |                     |                |
   v                     v                v
PostgreSQL + PostGIS   Storage        Realtime
   |                                      |
   +----------+-------------+-------------+
              |             |
              v             v
          Payments       Push
              |
              v
           Payouts
```

## 5. Identity and Roles

A single authenticated account can have customer and/or professional capabilities. Do not create separate auth accounts for each role.

### Core records
- `profiles`: shared identity/contact/profile data.
- `professional_profiles`: professional-only marketplace configuration and verification state.
- `professional_skills`: skills/services offered.
- `professional_availability`: online/offline and availability metadata.

Role switching therefore becomes a UI capability rather than an account migration.

## 6. Core Domain Model

### Taxonomy
- `skill_categories(id, name, slug, active, sort_order)`
- `skills(id, category_id, name, slug, active)`

### Profiles
- `profiles(id, auth_user_id, display_name, phone, avatar_path, customer_rating, created_at, updated_at)`
- `professional_profiles(profile_id, bio, years_experience, verification_status, professional_rating, completed_jobs, service_radius_m, is_online, accepting_jobs, created_at, updated_at)`
- `professional_skills(id, professional_id, skill_id, title, description, base_price_minor, currency, active)`

### Location
- `professional_locations(professional_id, position geography(Point,4326), updated_at)`
- `saved_addresses(id, profile_id, label, address_text, position geography(Point,4326), is_default)`

Precise professional coordinates are private. Discovery returns a calculated distance and an intentionally approximate location representation.

### Jobs and quotes
- `job_requests(id, customer_id, skill_id, requested_professional_id, description, budget_min_minor, budget_max_minor, currency, scheduled_for, job_position, address_text, status, expires_at, created_at, updated_at)`
- `job_request_photos(id, job_request_id, storage_path, created_at)`
- `quotes(id, job_request_id, professional_id, amount_minor, currency, note, status, expires_at, created_at)`
- `bookings(id, job_request_id, customer_id, professional_id, accepted_quote_id, agreed_amount_minor, currency, status, scheduled_for, started_at, completion_submitted_at, customer_confirmed_at, completed_at, created_at, updated_at)`
- `booking_status_history(id, booking_id, from_status, to_status, actor_id, metadata jsonb, created_at)`

### Communication
- `conversations(id, booking_id, created_at)`
- `conversation_members(conversation_id, profile_id, last_read_at)`
- `messages(id, conversation_id, sender_id, body, attachment_path, created_at)`

### Trust
- `reviews(id, booking_id, reviewer_id, reviewee_id, rating, body, created_at)`
- `verification_documents(id, professional_id, type, storage_path, status, reviewed_at)`
- `reports(id, reporter_id, booking_id, reported_profile_id, category, description, status, created_at)`
- `disputes(id, booking_id, opened_by, reason, status, resolution, created_at, resolved_at)`

### Money
- `payments(id, booking_id, provider, provider_reference, amount_minor, currency, status, idempotency_key, created_at, updated_at)`
- `payouts(id, professional_id, provider_reference, amount_minor, currency, status, created_at, updated_at)`
- `ledger_entries(id, profile_id, booking_id, type, amount_minor, currency, reference, created_at)`

### System
- `notifications(id, profile_id, type, title, body, data jsonb, read_at, created_at)`
- `push_tokens(id, profile_id, token, platform, last_seen_at)`
- `audit_events(id, actor_id, entity_type, entity_id, action, metadata jsonb, created_at)`

## 7. Geospatial Search

PostGIS is a core dependency.

A nearby-professional query must filter by:
- requested skill;
- professional active status;
- verification requirement;
- `is_online = true`;
- `accepting_jobs = true`;
- professional service radius;
- customer-selected radius;
- distance between customer search point and professional location.

Conceptually:

```sql
ST_DWithin(
  professional_locations.position,
  customer_search_point,
  LEAST(customer_radius_m, professional_profiles.service_radius_m)
)
```

Order primarily by marketplace relevance, then distance—not simply nearest-first. Ranking can later incorporate rating, completion rate, response rate and recency.

Never return raw `professional_locations.position` through the public discovery API.

## 8. Marketplace State Machines

### Job request
```text
DRAFT
  -> REQUESTED
       -> DECLINED
       -> EXPIRED
       -> QUOTED
       -> ACCEPTED
```

A quote may be superseded by a later counter-offer. Only one quote may become the accepted commercial agreement.

### Booking
```text
CONFIRMED
  -> ON_THE_WAY
  -> ARRIVED
  -> IN_PROGRESS
  -> COMPLETION_SUBMITTED
  -> CUSTOMER_CONFIRMED
  -> PAYMENT_PROCESSING
  -> PAID
  -> REVIEWED
```

Permitted states may also branch to `CANCELLED` or `DISPUTED` according to policy.

All transitions are validated server-side. A transition must check actor, current state, authorization and required data. Every successful transition writes `booking_status_history`.

## 9. Core Server Operations

Version domain operations independently of UI screens.

### Discovery
- `searchProfessionals(skillId, lat, lng, radiusM, filters)`
- `getProfessionalProfile(professionalId)`

### Requests and quotes
- `createJobRequest(payload)`
- `respondToJobRequest(requestId, action)`
- `sendQuote(requestId, amount, note)`
- `counterQuote(quoteId, amount, note)`
- `acceptQuote(quoteId)`
- `declineQuote(quoteId)`

### Booking lifecycle
- `markOnTheWay(bookingId)`
- `markArrived(bookingId)`
- `startJob(bookingId)`
- `submitCompletion(bookingId, finalAmount, notes, photos)`
- `confirmCompletion(bookingId)`
- `cancelBooking(bookingId, reason)`
- `openDispute(bookingId, reason)`

### Money
- `createPaymentIntent(bookingId)`
- `handlePaymentWebhook(event)`
- `requestPayout(...)`

Payment provider webhooks, not the mobile client, determine authoritative payment success.

## 10. Realtime Events

Realtime should improve UX, not replace durable state.

Important events:
- job request created;
- professional response received;
- quote created/updated;
- quote accepted;
- booking confirmed;
- professional on the way;
- professional arrived;
- job started;
- completion submitted;
- customer confirmed;
- payment status changed;
- new chat message.

On reconnect, the client always refetches authoritative state.

## 11. Notifications

Push notifications are derived from durable domain events.

Examples:
- customer sends request -> professional notified;
- professional sends quote -> customer notified;
- customer accepts quote -> professional notified;
- professional goes on the way -> customer notified;
- completion submitted -> customer notified;
- payment succeeds -> both sides notified.

Notification delivery failure must never roll back a marketplace transaction.

## 12. Storage

Use private buckets for:
- verification documents;
- job-request photos;
- completion photos;
- chat attachments.

Use signed, short-lived URLs for private media. Avatar/portfolio visibility can have separate policies.

Do not put identity documents in publicly readable storage.

## 13. Authorization and RLS

Minimum rules:
- users can read/update their own private profile data;
- public professional discovery exposes only a safe professional projection;
- customers can access jobs/bookings they own;
- professionals can access requests explicitly offered to them and bookings assigned to them;
- conversation access requires membership;
- verification documents are owner/admin restricted;
- payment/payout mutations are server-only;
- users cannot directly mutate ratings, completed-job counts, payment status or verification status.

Administrative access must use a separate privileged path with auditable actions.

## 14. Privacy

- Do not expose exact live professional coordinates before confirmation.
- Do not expose a customer's precise job address to unrelated professionals.
- Discovery should return distance/area rather than raw coordinates.
- Location updates should be rate-limited and retained only as required.
- Avoid storing unnecessary location history.
- Sensitive verification documents require explicit retention/deletion policy before launch.

## 15. Payments and Ledger

Payments are an adapter boundary because the South African marketplace/payment provider is not finalized.

Required provider capabilities:
- ZAR/card support;
- secure hosted/tokenized payment flow;
- marketplace-compatible payouts or a compliant payout model;
- webhooks;
- refunds;
- reconciliation identifiers.

Never store raw card numbers or CVV.

Maintain an internal immutable ledger separate from provider status. Platform fees, professional earnings, refunds and payouts should be represented as ledger entries so balances can be reconciled.

## 16. Mobile Application Structure

Recommended feature-oriented structure:

```text
app/
  (auth)/
  (customer)/
  (professional)/
  booking/
src/
  components/
  features/
    auth/
    discovery/
    professionals/
    jobs/
    quotes/
    bookings/
    chat/
    payments/
    reviews/
    verification/
  lib/
    api/
    auth/
    query/
    validation/
  domain/
    booking/
    jobs/
    money/
    location/
  types/
  theme/
```

UI components should not contain marketplace transition logic. Domain/API layers expose typed operations.

## 17. Configuration and Environments

Maintain at least:
- local/development;
- staging;
- production.

No secrets in Expo source, Git history or client-visible environment variables. Public client keys are distinguished from server secrets.

Database schema changes use migrations committed to Git. Production changes are never made manually without a corresponding migration.

## 18. Observability

Before beta, capture:
- structured server errors;
- request correlation IDs;
- failed domain transitions;
- payment webhook processing;
- push failures;
- authentication failures;
- performance of geospatial queries.

Product analytics should measure:
- search-to-result rate;
- search-to-request conversion;
- professional response rate;
- time to first response;
- quote acceptance;
- booking completion;
- cancellation;
- repeat customers;
- review score.

Avoid sending sensitive addresses, message contents or identity documents into analytics.

## 19. Testing Strategy

### Unit
- state transition rules;
- pricing/money calculations;
- radius/service-area logic;
- validation.

### Database
- migrations;
- PostGIS search;
- RLS policies;
- uniqueness/foreign-key constraints.

### Integration
- request -> quote -> acceptance -> booking;
- booking lifecycle;
- payment webhook idempotency;
- notifications from domain events.

### E2E
Critical MVP path:
1. professional signs in;
2. configures Plumbing + service radius;
3. goes online;
4. customer searches Plumbing;
5. professional appears;
6. customer sends request;
7. professional receives request;
8. professional quotes/accepts;
9. customer accepts;
10. booking progresses through completion;
11. payment succeeds;
12. review is submitted.

## 20. First Engineering Milestone

**Marketplace Engine v0**

Acceptance criteria:
- customer and professional accounts work;
- professional can configure at least one skill;
- professional can set service radius;
- professional can go online/offline;
- location is stored privately;
- customer can search a skill within a chosen radius;
- only eligible nearby professionals are returned;
- result includes approximate distance, rating, availability and safe profile data;
- customer can send a request to a professional;
- professional receives the request in-app;
- professional can accept, decline or send a quote;
- state changes persist and synchronize to both clients;
- unauthorized users cannot access the request.

This milestone intentionally excludes production payments, full chat, payouts and advanced ranking.

## 21. Delivery Sequence

1. Repository cleanup and engineering conventions.
2. Supabase project/environment configuration.
3. SQL migrations: profiles, skills, professional setup, PostGIS.
4. Auth + role-aware onboarding.
5. Professional availability/location.
6. Nearby skill discovery.
7. Job requests.
8. Professional request inbox.
9. Quote/accept/decline.
10. Realtime synchronization and push.
11. Booking lifecycle.
12. Chat.
13. Completion/reviews.
14. Payment adapter + selected provider.
15. Payouts/ledger.
16. Verification, reports, disputes and admin.
17. Security/performance pass.
18. Private beta.

## 22. Engineering Definition of Done

A feature is complete only when:
- domain behavior is specified;
- schema/migration exists where required;
- authorization/RLS is implemented;
- typed client/server contract exists;
- loading/empty/error/offline states exist;
- telemetry is appropriate and privacy-safe;
- automated tests cover critical rules;
- approved AnySkill UI is implemented;
- acceptance criteria pass on staging.

## 23. Immediate Next Artifacts

The specification should now be converted into executable engineering artifacts:

1. `docs/engineering/DATA_MODEL.md` — detailed ER model and constraints.
2. `docs/engineering/API_CONTRACT.md` — request/response schemas and domain errors.
3. `supabase/migrations/*` — initial PostgreSQL/PostGIS schema and RLS.
4. TypeScript domain types and validation schemas.
5. Environment template and local setup documentation.

The first code milestone is not another mock screen. It is a working geospatial marketplace slice from **professional online -> customer search -> request -> professional response**.
