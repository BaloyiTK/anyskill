ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'SUPPORT_AGENT';
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'IDENTITY_REVIEWER';
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'FINANCE_OFFICER';
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'FRAUD_OFFICER';

-- Enforce exactly one Super Administrator membership at database level.
CREATE UNIQUE INDEX "staff_memberships_single_super_admin_idx" ON "staff_memberships" ("role") WHERE "role" = 'SUPER_ADMIN';
