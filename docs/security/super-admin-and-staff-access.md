# Super Administrator and staff access

AnySkill has one initial Super Administrator. The database migration creates a unique index that permits only one `SUPER_ADMIN` membership, including inactive memberships. The controlled bootstrap below creates or reactivates that one membership; it cannot appoint a different second Super Administrator.

## Bootstrap the single Super Administrator

1. Register the owner's normal AnySkill account.
2. Verify the account's email address.
3. Back up the production database and apply all Prisma migrations.
4. In `apps/api/prisma/bootstrap-super-admin.sql`, replace the example email with the exact email address of that existing owner account.
5. Run the SQL against the intended database using a privileged database connection.
6. Confirm the resulting membership is active and has role `SUPER_ADMIN`, then sign in through the normal AnySkill authentication flow.

The bootstrap is deliberately fail-closed:
- It refuses an account that does not exist, is deleted, or has not verified its email.
- It refuses to appoint a different Super Administrator if one already exists.
- It refuses to silently overwrite a different staff role on the owner account.
- It is safe to rerun for the same Super Administrator account.
- It does not create a user, set a password, bypass authentication, or grant marketplace provider status.

Do not commit real owner email addresses, passwords, access tokens, or database credentials to the repository.

## Staff management

The Super Administrator can add a staff member by the email address of an existing AnySkill user, assign one operational role, change that role, or suspend/reactivate staff access. Staff accounts continue to use the normal AnySkill authentication and password-reset process; this screen does not create passwords or bypass account registration.

Available operational roles:
- `PROVIDER_REVIEWER`
- `IDENTITY_REVIEWER`
- `SUPPORT_AGENT`
- `FINANCE_OFFICER`
- `FRAUD_OFFICER`
- `ADMIN`

The Super Administrator role is intentionally excluded from the role selector and staff API. The Super Administrator membership cannot be modified from the portal. Staff changes are recorded in `staff_audit_logs`. Only a Super Administrator can use staff-management endpoints; an ordinary Administrator cannot grant staff access or elevate another account.

## API

- `GET /api/v1/admin/staff`
- `POST /api/v1/admin/staff` with email and role
- `PATCH /api/v1/admin/staff/:userId` with a role change or active-status change

The backend is the authorization boundary. UI visibility is not relied on for security.
