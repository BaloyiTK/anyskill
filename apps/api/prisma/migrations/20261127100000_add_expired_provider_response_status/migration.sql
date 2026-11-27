-- Preserve compatibility with existing provider response rows whose status is EXPIRED.
-- The value already exists in the production database; IF NOT EXISTS also makes
-- this migration safe where the enum has already been extended.
ALTER TYPE "ProviderResponseStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
