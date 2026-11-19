-- Convert existing onboarding skills into independent pending review records.
INSERT INTO "provider_skills" (
  "id", "user_id", "category", "details", "status",
  "submitted_at", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  d."user_id",
  lower(trim(skill->>'category')),
  skill,
  'PENDING'::"ProviderSkillStatus",
  COALESCE(d."submitted_at", d."updated_at"),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "onboarding_drafts" d
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(d."skills") = 'array' THEN d."skills" ELSE '[]'::jsonb END
) AS skill
WHERE jsonb_typeof(skill) = 'object'
  AND length(trim(COALESCE(skill->>'category', ''))) >= 2
ON CONFLICT ("user_id", "category") DO NOTHING;

-- Existing whole-provider approvals are not sufficient evidence of an
-- individually approved skill. Require the new identity + skill conditions.
UPDATE "users" u
SET "provider_role_status" = 'PENDING'::"MarketplaceRoleStatus",
    "active_marketplace_mode" = CASE
      WHEN u."seeker_role_status" = 'ACTIVE'::"MarketplaceRoleStatus"
        THEN 'SEEKER'::"RegistrationMode"
      ELSE NULL
    END
WHERE u."provider_role_status" = 'ACTIVE'::"MarketplaceRoleStatus"
  AND u."provider_role_status" <> 'SUSPENDED'::"MarketplaceRoleStatus"
  AND EXISTS (
    SELECT 1 FROM "provider_role_applications" a WHERE a."user_id" = u."id"
  );
