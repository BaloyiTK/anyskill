# Super Administrator and staff access

AnySkill uses one initial Super Administrator account. This account is provisioned once through a controlled database operation after the owner's normal user account exists. The public API and Admin Portal cannot create another Super Administrator.

## Bootstrap the single Super Administrator

1. Create the owner's normal AnySkill account and verify its email.
2. Back up the production database and apply migrations.
3. Run the SQL in `apps/api/prisma/bootstrap-super-admin.sql` after replacing `owner@example.com` with the exact owner account email.

The partial unique database index permits only one Super Administrator membership. If another Super Administrator already exists, the insert/update fails rather than silently creating a second one. Verify the account and sign in to the Admin Portal after bootstrap.

## Staff management

The Super Administrator can add a staff member by the email address of an existing AnySkill user, assign one operational role, change that role, or suspend/reactivate staff access. Staff accounts continue to use the normal AnySkill authentication and password-reset process; this screen does not create passwords or bypass account registration.

Available operational roles:
- `PROVIDER_REVIEWER`
- `IDENTITY_REVIEWER`
- `SUPPORT_AGENT`
- `FINANCE_OFFICER`
- `FRAUD_OFFICER`
- `ADMIN`

The Super Administrator role is intentionally excluded from the role selector and staff API. Staff changes are recorded in `staff_audit_logs`. The Super Administrator membership cannot be modified from the portal. Only a Super Administrator can use staff-management endpoints; an ordinary Administrator cannot grant staff access or elevate another account.

## API

- `GET /api/v1/admin/staff`
- `POST /api/v1/admin/staff` with email and role
- `PATCH /api/v1/admin/staff/:userId` with a role change or active-status change

The backend is the authorization boundary. UI visibility is not relied on for security.