# PayFast sandbox reconciliation

AnySkill's PayFast integration remains **sandbox-only**. This report is an operational reconciliation aid; it does not enable live charges, real Provider payouts, or manual payment confirmation.

## Finance endpoint

`GET /api/v1/admin/marketplace/payments/reconciliation`

Authentication: signed-in staff account with an active `FINANCE_OFFICER`, `ADMIN`, or `SUPER_ADMIN` membership. The endpoint is read-only.

The report includes:
- Recent sandbox checkouts (up to 200), AnySkill job/payment statuses, PayFast references, and associated financial ledger entries.
- Aggregated ledger counts and amounts by transaction type and status.
- Exceptions for checkouts pending longer than 30 minutes, checkout/job status mismatches, completed checkouts without a completed Seeker-payment ledger entry, missing Provider/commission ledger entries, and split amounts that do not add up to the gross payment.
- Jobs marked `PAYFAST_PAID` that have no completed sandbox checkout.

## Reconciliation procedure

1. Compare `merchantPaymentId` with the PayFast sandbox ITN/payment record.
2. For a successful payment, confirm PayFast reports `COMPLETE`, the PayFast payment ID matches, the gross amount matches the approved AnySkill job amount, and AnySkill has a completed `SEEKER_PAYMENT` ledger entry.
3. Confirm the Provider's 90% earnings entry and the platform's 10% commission entry sum to the approved gross job amount. Provider payout remains `PENDING`; it is not a bank transfer.
4. Investigate every exception before taking any operational action. Never mark a payment successful based only on the browser return page or a screenshot.
5. A payment is only recorded as successful after the backend validates the PayFast ITN signature, source IP, merchant ID, server-side validation response, and expected gross amount.

## Financial rules

- Job completion recognition and Provider earnings are separate from the Seeker's successful payment and from any later Provider bank payout.
- A completed job can appear in Provider earnings before the Seeker debit is confirmed.
- A PayFast payment confirmation does not mean a Provider payout has been sent.
- Never store full card numbers or CVVs. Saved PayFast tokens remain encrypted at rest.
- Do not put merchant credentials, passphrases, token-encryption keys, or other secrets in source control or chat.

## Current scope

The API deliberately rejects any `PAYFAST_MODE` other than `sandbox`. Sandbox transactions do not move real money. Live payments and real Provider payouts remain disabled pending explicit authorization, PayFast merchant onboarding/configuration, live-mode security review, and end-to-end live readiness testing.
