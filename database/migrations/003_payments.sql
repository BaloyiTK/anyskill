-- Payment ledger foundation. Provider-neutral and PostgreSQL 10 compatible.
BEGIN;
CREATE TABLE payments (
 id uuid PRIMARY KEY, booking_id uuid NOT NULL REFERENCES bookings(id), customer_id uuid NOT NULL REFERENCES users(id),
 professional_id uuid NOT NULL REFERENCES users(id), amount_minor bigint NOT NULL CHECK(amount_minor>=0), currency varchar(3) NOT NULL DEFAULT 'ZAR',
 status varchar(32) NOT NULL CHECK(status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','REFUNDED')),
 provider varchar(64), provider_reference varchar(255), idempotency_key varchar(255) NOT NULL UNIQUE,
 failure_code varchar(128), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_success_booking_idx ON payments(booking_id) WHERE status='SUCCEEDED';
CREATE TABLE ledger_entries (
 id uuid PRIMARY KEY, payment_id uuid NOT NULL REFERENCES payments(id), booking_id uuid NOT NULL REFERENCES bookings(id),
 user_id uuid REFERENCES users(id), entry_type varchar(32) NOT NULL CHECK(entry_type IN ('CUSTOMER_CHARGE','PROFESSIONAL_EARNING','PLATFORM_FEE','REFUND')),
 amount_minor bigint NOT NULL, currency varchar(3) NOT NULL DEFAULT 'ZAR', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user_idx ON ledger_entries(user_id,created_at);
CREATE TABLE payouts (
 id uuid PRIMARY KEY, professional_id uuid NOT NULL REFERENCES users(id), amount_minor bigint NOT NULL CHECK(amount_minor>0),
 currency varchar(3) NOT NULL DEFAULT 'ZAR', status varchar(32) NOT NULL CHECK(status IN ('PENDING','PROCESSING','PAID','FAILED')),
 provider_reference varchar(255), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
