# Dual marketplace roles and Provider approval

**Status:** Approved product requirement

## Account model

AnySkill uses one user account and one identity for both marketplace roles. Seeker and Provider are independently activated capabilities belonging to the same user. `initialMode` is retained only as a legacy/registration preference; it is not an authorization source.

Each account has `seekerRoleStatus`, `providerRoleStatus`, and `activeMarketplaceMode`. Only an `ACTIVE` role may be selected as the active marketplace mode. An account that has no active role yet has a null active mode; this can happen when someone registers as Provider and is awaiting manual approval. Switching mode changes the app experience; it does not create another account, session, identity, or user ID.

## Provider activation: manual review

A user may submit a Provider application while continuing to use an already-active Seeker role. A Provider-first registrant may have no active marketplace role until the application is approved or they separately activate Seeker. The application captures a snapshot of public name, skills, portfolio and relevant qualifications. Client-supplied role/status values never activate Provider access.

Provider application states: `PENDING`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `NEEDS_INFORMATION`.

Provider role states: `NOT_REQUESTED`, `PENDING`, `ACTIVE`, `REJECTED`, `REQUIRES_INFORMATION`, `SUSPENDED`.

Only an authorised staff member with Provider Reviewer, Admin or Super Admin membership may decide an application. Approval activates Provider and provisions an unavailable Provider profile from the approved public name and skills; the user must finish service areas, delivery modes, pricing and availability before matching. Rejection or a request for more information does not disable another active role. Applicants may update details and resubmit after rejection or a request for information.

Reviewer decisions are recorded in `staff_audit_logs`, including actor, target account, action, reason and application identifier. Staff membership is separate from marketplace roles and is granted only through a controlled administrative process, never through a public API or user-editable profile.

## Seeker activation and switching

A user with no active Seeker role may request Seeker activation. Seeker activation does not grant Provider permissions. Both roles may be active simultaneously. The API persists `activeMarketplaceMode` and refuses to switch to a role that is not `ACTIVE`.

## Identity and professional verification

Identity verification is shared at account level. It is not repeated merely because the user activates a second role. Identity verification does not establish professional qualifications, licences, skills or work quality. Provider application review is a separate business decision and may request evidence appropriate to the skills offered.

The backend is authoritative. Marketplace endpoints enforce the required active role and identity policy server-side. UI hiding/disabling controls are only a user-experience measure.

## Existing account migration

The migration preserves existing role usage: a role is activated when it was the original registration mode or the account has corresponding marketplace history/profile data. Existing users are not forced to create another account or reapply for a role they were already using.


## API workflow

- `GET /api/v1/marketplace/roles` returns role states and the Provider application decision.
- `POST /api/v1/marketplace/roles/provider/applications` submits or resubmits a Provider application.
- `POST /api/v1/marketplace/roles/seeker/activate` activates Seeker access for an account that does not yet have it.
- `PATCH /api/v1/marketplace/roles/active-mode` changes the active mode only when the requested role is already active.
- `GET /api/v1/admin/provider-applications` lists up to 100 pending/in-review applications for authorised staff.
- `POST /api/v1/admin/provider-applications/{applicationId}/start-review` records the start of manual review.
- `POST /api/v1/admin/provider-applications/{applicationId}/decision` accepts `APPROVED`, `REJECTED` or `NEEDS_INFORMATION` plus a required reason.

Reviewer decisions are concurrency-safe and a reviewer cannot review or decide their own application. The decision and review-start events are written to the staff audit log.

## Granting Provider Reviewer access

Staff memberships are not self-service. After validating the staff account out of band, an authorised database operator can grant a reviewer membership using that user's UUID:

```sql
INSERT INTO staff_memberships
  (id, user_id, role, is_active, created_at, updated_at)
VALUES
  (gen_random_uuid(), '<verified-staff-user-uuid>', 'PROVIDER_REVIEWER', TRUE, NOW(), NOW())
ON CONFLICT (user_id)
DO UPDATE SET role = EXCLUDED.role, is_active = TRUE, updated_at = NOW();
```

Revoke access by setting `is_active = FALSE`. Keep this operation restricted to the production database administration process; do not expose it through the public API.

## Staff bootstrap

Create staff memberships only through a controlled database/admin operation after verifying the staff member's identity and authorisation. Do not expose staff-role assignment to public account APIs. Review decisions and access to application records should be audited.