-- Development helper only. Run manually after a professional submits verification.
-- Replace the UUID before execution. Never expose this as a public API endpoint.
UPDATE professional_profiles SET verification_status='VERIFIED',updated_at=now()
WHERE user_id='00000000-0000-0000-0000-000000000000' AND verification_status='PENDING';
