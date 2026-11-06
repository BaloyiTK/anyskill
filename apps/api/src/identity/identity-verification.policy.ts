import type { IdentityVerificationStatus } from "@anyskill/contracts";

/**
 * Server-side marketplace access policy.
 * Call only after resolving the authenticated account and its current
 * verification state from trusted server-side records.
 */
export function canAccessMarketplace(
  status: IdentityVerificationStatus,
): boolean {
  return status === "verified";
}
