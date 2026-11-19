/**
 * A single AnySkill account can operate in either or both marketplace modes.
 */
export type UserMode = "skill_seeker" | "skill_provider";

/**
 * Only the "verified" state grants marketplace access.
 */
export type IdentityVerificationStatus =
  | "not_started"
  | "pending"
  | "verified"
  | "failed"
  | "requires_information"
  | "under_review"
  | "suspended"
  | "revoked";

export interface IdentityVerificationSummary {
  status: IdentityVerificationStatus;
  verifiedAt: string | null;
  reviewRequired: boolean;
}
