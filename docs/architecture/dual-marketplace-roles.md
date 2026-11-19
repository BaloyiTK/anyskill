# Dual marketplace roles and independent Provider verification

**Status:** Approved product requirement

## Account model

AnySkill uses one user account and one identity for both marketplace roles. Seeker and Provider are independently activated capabilities belonging to the same user. `initialMode` is retained as a legacy registration preference; it is not an authorization source.

Each account has `seekerRoleStatus`, `providerRoleStatus`, and `activeMarketplaceMode`. Only an `ACTIVE` role may be selected as the active marketplace mode. Switching mode changes the app experience; it does not create another account, session, identity, or user ID. Both roles may be active at the same time.

## Provider access: identity plus individual skill decisions

There is no whole-Provider application approval or combined Provider decision.

1. The user submits identity documents and a live selfie for an independent identity review.
2. An authorised Identity Reviewer verifies or rejects the identity case. Rejection requires a reason.
3. Each submitted Provider skill appears as its own review item. An authorised Skills Reviewer assesses and approves or rejects that skill independently. Rejection requires a reason.
4. A skill cannot be approved until the account identity is verified. The backend enforces this rule; disabling the button in the admin portal is only a user-experience measure.
5. Provider access becomes active when identity is verified and at least one skill is approved, unless Provider access is suspended. Staff do not approve the Provider role directly.
6. Approving one skill never approves another. Rejecting one skill does not revoke another already-approved skill. Seeker access remains independent and is not disabled by Provider identity or skill decisions.

Identity verification is shared at account level. It does not establish professional qualifications, licences, skills or work quality. Skill review is a separate decision and may consider the submitted description, experience, qualifications, licences and portfolio evidence.

## Administrative permissions and audit

Identity review endpoints require the Identity Reviewer permission. Individual skill review endpoints require the Provider Reviewer permission. Account visibility and staff management retain their own role requirements. Reviewers cannot decide their own identity case or skill. Decisions are concurrency-safe and written to the staff audit log with actor, target, decision and reason.

There are no administrative Provider-application listing, start-review or whole-Provider decision endpoints. The admin portal uses only the independent identity and skill queues.

Staff membership is separate from marketplace roles and is granted only through a controlled administrative process, never through a public API or user-editable profile.

## Seeker activation and switching

A user with no active Seeker role may activate Seeker access. Seeker activation does not grant Provider permissions. The API persists `activeMarketplaceMode` and refuses to switch to a role that is not `ACTIVE`.

## Existing account migration

The migration preserves existing role usage. Existing users are not forced to create another account or reapply for a role they were already using. Legacy Provider-application records may remain for historical compatibility, but they are not an approval source and cannot activate Provider access.

## API workflow

- `GET /api/v1/marketplace/roles` returns account role states.
- `POST /api/v1/marketplace/roles/seeker/activate` activates Seeker access for an account that does not yet have it.
- `PATCH /api/v1/marketplace/roles/active-mode` changes the active mode only when the requested role is already active.
- `GET /api/v1/admin/identity-reviews` lists identity cases awaiting review.
- `POST /api/v1/admin/identity-reviews/{caseId}/decision` verifies or rejects one identity case.
- `GET /api/v1/admin/skill-reviews` lists individual skills awaiting review.
- `POST /api/v1/admin/skill-reviews/{skillId}/decision` approves or rejects one skill.
- `GET /api/v1/admin/accounts` returns account modes, identity state and each skill's individual decision.

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
