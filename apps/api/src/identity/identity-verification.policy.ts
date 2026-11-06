import type { IdentityVerificationStatus } from "@anyskill/contracts";

/**
 * Identity verification is enforced at consequential marketplace actions,
 * not as a blanket restriction on browsing or receiving incoming requests.
 */
export type IdentityRequiredAction = "SEEKER_SUBMIT_REQUEST" | "SEEKER_SELECT_PROVIDER" | "PROVIDER_ACCEPT_REQUEST";

export function canPerformVerifiedAction(
  status: IdentityVerificationStatus,
  _action: IdentityRequiredAction,
): boolean {
  return status === "verified";
}
