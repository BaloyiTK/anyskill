# Provider identity and skill approval workflow

**Status:** Agreed product requirement  
**Applies to:** AnySkill Provider onboarding and subsequent Provider profile updates

## Governing rule

A Provider profile is approved when, and only when:

`identityVerification = VERIFIED` **and** the Provider has **at least one individually approved skill**.

There is no separate manual Provider-profile approval decision. Provider profile approval is derived from identity verification and skill approval.

## Initial onboarding sequence

1. The applicant completes the initial profile and submits identity evidence.
2. Identity verification is reviewed first by an authorised identity reviewer.
3. Skills must not be approved while identity verification is anything other than `VERIFIED`.
4. Once identity is verified, each submitted skill can be reviewed and decided independently.
5. The Provider profile becomes approved automatically when the first skill is approved.
6. The initial onboarding experience ends once the required initial profile is approved. The user then enters the normal marketplace experience.

## Skill review lifecycle

- Each skill has its own review status and decision history.
- A skill can be pending, under review, approved, rejected, or require more information.
- A decision on one skill must not automatically approve or reject another skill.
- A Provider may have a mixture of approved and pending/rejected skills.
- At least one approved skill is required for Provider profile approval and Provider marketplace access.
- If all skills are pending, rejected, or require information, the Provider profile is not approved.

## Changes after initial approval

- Adding a skill after onboarding is complete creates a new skill review item.
- The new skill must be approved before it can be represented as an approved Provider skill.
- Adding or editing a skill must not restart initial onboarding or revoke an otherwise approved Provider profile.
- Existing approved skills remain approved unless that specific skill is explicitly re-reviewed and its status changed through an authorised review action.
- Profile and portfolio management remain distinct from the initial onboarding submission lifecycle.

## Access and safety

- Provider marketplace access requires a verified identity and at least one approved skill.
- Account-level suspension remains an independent safety control and must continue to block access.
- Identity suspension or revocation must block Provider access even if one or more skills were previously approved.
- Seeker access and Seeker approval are independent of this Provider workflow; dual-role accounts retain their existing Seeker access.
- Identity verification establishes identity only. It does not certify qualifications, skill proficiency, or work quality.

## Administration and audit

- Identity decisions are made in the identity-review workflow by authorised identity reviewers.
- Skill decisions are made per skill by authorised Provider/skill reviewers, and only after identity is verified.
- Every review action records the reviewer, timestamp, decision, and reason in the audit trail.
- Review notifications must describe the specific identity or skill decision; they must not imply that all skills are approved when only one has been approved.

## Explicit non-goals

- Do not create a third, separate Provider approval step after identity and skill review.
- Do not require every submitted skill to be approved before the Provider profile can be approved.
- Do not restart onboarding when a Provider adds a skill after initial approval.
- Do not conflate identity verification with qualification verification or skill/work-quality assessment.
- Do not remove existing account suspension controls.
