# PayFast sandbox setup

AnySkill currently supports PayFast **sandbox only**. The implementation does not contain a live PayFast checkout path.

## 1. Create a PayFast sandbox merchant

1. Register/sign in at https://sandbox.payfast.co.za.
2. Open the sandbox merchant dashboard and copy the sandbox Merchant ID and Merchant Key.
3. Set a Security Passphrase in the sandbox account settings.
4. To test card-on-file, open Settings → Recurring Billing, enable Tokenization and accept PayFast's recurring-billing terms.
5. Keep these sandbox credentials separate from any live PayFast credentials.

## 2. Configure the API environment

Add these values to the API's local .env file. Do not commit .env or send merchant secrets through chat.

```dotenv
PAYFAST_MODE="sandbox"
PAYFAST_MERCHANT_ID="your-8-digit-sandbox-merchant-id"
PAYFAST_MERCHANT_KEY="your-sandbox-merchant-key"
PAYFAST_PASSPHRASE="your-sandbox-passphrase"
PAYFAST_PUBLIC_API_URL="https://your-public-https-api-host"
PAYFAST_RETURN_URL="https://your-public-https-api-host/api/v1/marketplace/payments/payfast/return"
PAYFAST_CANCEL_URL="https://your-public-https-api-host/api/v1/marketplace/payments/payfast/cancel"
PAYFAST_TOKEN_ENCRYPTION_KEY="a-random-secret-of-at-least-32-characters"
```

PAYFAST_PUBLIC_API_URL must be reachable over HTTPS from the internet. For local API testing, use a trusted HTTPS tunnel and point it at the local API port. PayFast sends ITN notifications to:

`/api/v1/marketplace/payments/payfast/itn`

The API constructs the notification URL from PAYFAST_PUBLIC_API_URL; do not put the API path in the base URL.

If the API is behind an HTTPS tunnel or reverse proxy, set TRUST_PROXY_HOPS to the exact number of trusted proxy hops (commonly 1 for a single tunnel). Do not set this to an arbitrary value: PayFast ITN sender-IP validation depends on Express resolving the real client IP correctly.

Generate a token-encryption key locally, for example with `openssl rand -hex 32`. The key encrypts PayFast card tokens at rest. It is not a PayFast credential.

## 3. Payment flow

- The Seeker can start checkout only after the job is completed and its completion has been approved.
- The checkout amount is taken from AnySkill's approved finalAmountDue; the client cannot supply or override it.
- The Seeker may opt in to card tokenization during the hosted PayFast checkout.
- PayFast ITN is checked against the configured merchant, signature, sender IP, PayFast's validation endpoint, and the expected amount before AnySkill records payment.
- A saved card is represented in AnySkill by an encrypted PayFast token. AnySkill never stores the full card number or CVV.
- Later ad-hoc charges use the PayFast token API and are still confirmed through ITN.
- Removing a saved card requests cancellation of the token with PayFast before marking it revoked locally.

## 4. Important sandbox limitations

- Sandbox payments do not move real money.
- A successful PayFast payment is not the same as a Provider bank payout. AnySkill records Provider earnings as pending; it does not currently transfer funds to independent Providers.
- PayFast sandbox uses its test wallet for ordinary one-off checkout. Tokenization testing uses the sandbox recurring-payment/card test flow. The token is returned through ITN.
- PayFast's ITN sender IP ranges can change. Keep the API's allowlist aligned with PayFast's current official developer documentation.

## 5. API endpoints

- `POST /api/v1/marketplace/requests/:requestId/payment/payfast` — create or resume hosted sandbox checkout.
- `POST /api/v1/marketplace/requests/:requestId/payment/payfast/saved-card` — charge a saved token for the approved completed-job amount.
- `GET /api/v1/marketplace/payment-methods` — list the Seeker's active saved cards (masked details only).
- `DELETE /api/v1/marketplace/payment-methods/:paymentMethodId` — cancel and remove a saved card.
- `GET /api/v1/marketplace/payments/payfast/checkout/:merchantPaymentId` — hosted form that redirects to PayFast.
- `POST /api/v1/marketplace/payments/payfast/itn` — public PayFast ITN callback.