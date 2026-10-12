# Payments architecture

AnySkill keeps payment state server-authoritative and provider-neutral.

Flow: CUSTOMER_CONFIRMED -> PAYMENT_PROCESSING -> PAID. Creating a payment uses a unique idempotency key. A provider adapter will create the external payment. Only a verified provider webhook may mark a payment SUCCEEDED and move the booking to PAID.

Ledger entries are immutable accounting records. On successful settlement the server records CUSTOMER_CHARGE, PROFESSIONAL_EARNING and (when configured) PLATFORM_FEE entries. Payouts are separate from customer payments.

Never accept a client request claiming a payment succeeded. Never store card details in AnySkill. Provider secrets stay server-side.

The current implementation creates PENDING payment intents and exposes professional earnings. It deliberately does not simulate settlement until a payment provider is selected and webhook signature verification is implemented.
