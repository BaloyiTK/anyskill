import type { IdentityVerificationStatus } from "@anyskill/contracts";

/**
 * Identity verification is enforced at consequential marketplace actions,
 * not as a blanket restriction on browsing or receiving incoming requests.
 */
export type IdentityRequiredAction = "SEEKER_SUBMIT_REQUEST" | "SEEKER_SELECT_PROVIDER" | "PROVIDER_ACCEPT_REQUEST" | "PROVIDER_SUBMIT_ESTIMATE" | "PROVIDER_START_WORK" | "PROVIDER_REQUEST_EXTRA_HOURS" | "SEEKER_DECIDE_ESTIMATE" | "SEEKER_DECIDE_EXTRA_HOURS" | "PROVIDER_SUBMIT_COMPLETION" | "SEEKER_REVIEW_COMPLETION";

export function canPerformVerifiedAction(
  status: IdentityVerificationStatus,
  _action: IdentityRequiredAction,
): boolean {
  return status === "verified";
}
