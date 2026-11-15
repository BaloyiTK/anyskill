# Dual marketplace roles and Provider approval

**Status:** Approved product requirement

## Account model

AnySkill uses one user account and one identity for both marketplace roles. Seeker and Provider are independently activated capabilities belonging to the same user. `initialMode` is retained only as a legacy/registration preference; it is not an authorization source.

Each account has `seekerRoleStatus`, `providerRoleStatus`, and `activeMarketplaceMode`. Only an `ACTIVE` role may be selected as the active marketplace mode. Switching mode changes the app experience; it does not create another account, session, identity, or user ID.

## Provider activation: manual review

A user may submit a Provider application while continuing to use an already-active Seeker role. The application captures a snapshot of public name, skills, portfolio and relevant qualifications. Client-supplied role/status values never activate Provider access.

Provider application states: `PENDING`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `NEEDS_INFORMATION`.

Provider role states: `NOT_REQUESTED`, `PENDING`, `ACTIVE`, `REJECTED`, `REQUIRES_INFORMATION`, `SUSPENDED`.

Only an authorised staff member with Provider Reviewer, Admin or Super Admin membership may decide an application. Approval activates Provider; rejection or a request for more information does not disable another active role. Applicants may update details and resubmit after rejection or a request for information.

Reviewer decisions are recorded in `staff_audit_logs`, including actor, target account, action, reason and application identifier. Staff membership is separate from marketplace roles and is granted only through a controlled administrative process, never through a public API or user-editable profile.

## Seeker activation and switching

A user with no active Seeker role may request Seeker activation. Seeker activation does not grant Provider permissions. Both roles may be active simultaneously. The API persists `activeMarketplaceMode` and refuses to switch to a role that is not `ACTIVE`.

## Identity and professional verification

Identity verification is shared at account level. It is not repeated merely because the user activates a second role. Identity verification does not establish professional qualifications, licences, skills or work quality. Provider application review is a separate business decision and may request evidence appropriate to the skills offered.

The backend is authoritative. Marketplace endpoints enforce the required active role and identity policy server-side. UI hiding/disabling controls are only a user-experience measure.

## Existing account migration

The migration preserves existing role usage: a role is activated when it was the original registration mode or the account has corresponding marketplace history/profile data. Existing users are not forced to create another account or reapply for a role they were already using.

## Staff bootstrap

Create staff memberships only through a controlled database/admin operation after verifying the staff member's identity and authorisation. Do not expose staff-role assignment to public account APIs. Review decisions and access to application records should be audited.