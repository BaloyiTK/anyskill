# AnySkill payment collection and Provider settlement

**Decision status:** Product flow approved. PayGate Gateway integration and merchant capabilities are not yet verified or implemented.

## Product decisions

1. The Skill Seeker adds a debit or credit card during profile setup.
2. PayGate, not AnySkill, collects and stores the sensitive card data through a supported hosted/tokenised card flow.
3. AnySkill stores a reusable gateway token/reference and limited masked display metadata. It must never store or log the full card number (PAN) or CVV.
4. The Seeker approves the Provider's estimate before work starts.
5. After estimate approval, AnySkill pre-authorises the approved estimated amount against the saved card. The Provider may start only after the backend confirms a successful authorisation.
6. The card is charged/captured only after the Seeker approves the Provider's completed work.
7. If the Seeker rejects completion, capture is not triggered; the Provider follows the correction/resubmission workflow.
8. Provider settlement is a separate AnySkill process after successful customer payment capture. Do not assume the gateway's merchant settlement automatically pays the Provider.

## End-to-end flow

### A. Card setup during profile setup

- Present a PayGate-supported hosted/tokenised card setup experience.
- Explain that the card will be saved for future AnySkill job payments and obtain explicit consent.
- Use the gateway's supported customer/card verification or tokenisation operation.
- Store the gateway customer ID and reusable payment-method token/reference, brand, masked last four digits, expiry metadata if provided, consent timestamp/version and status.
- Support adding, replacing and removing a card. Replacing a card must not silently invalidate a payment already in progress. Prevent deletion of the only usable method while an active job authorisation depends on it, or require an explicit replacement first.
- Never request card details through ordinary AnySkill API DTOs, analytics, logs, crash reports or database fields.

### B. Estimate approval and authorisation

1. Provider submits the estimate.
2. Seeker approves the hours and total estimate.
3. Backend creates an idempotent payment/authorisation attempt linked to the job engagement and exact estimate version.
4. Backend requests pre-authorisation using the saved payment-method token.
5. Backend validates the gateway response/notification and reconciles transaction status server-side.
6. Only a confirmed authorised state permits the job to move to READY_TO_START/IN_PROGRESS and notifies the Provider.
7. A declined, failed, expired or uncertain authorisation blocks work start. An uncertain result must be reconciled before retrying to avoid duplicate holds.

**Meaning of “hold”:** A pre-authorisation reserves some of the cardholder's available funds/credit subject to issuer and gateway rules. It is not a transfer of funds to AnySkill, escrow, or completed collection. Authorisations expire and may be released by the issuer/gateway.

### C. Additional hours

- Each additional-hours request must include a reason, hours and calculated amount.
- Seeker approval is required before extra work.
- Before extra work starts, AnySkill must obtain a valid incremental authorisation or another supported authorisation for the revised total.
- Do not assume an existing authorisation can be increased, extended or reused. Confirm the gateway's exact rules and expiry window.
- If the original authorisation cannot cover the revised amount, pause the extra work until the revised payment assurance is confirmed.

### D. Completion approval and capture

1. Provider submits completion notes and evidence.
2. Seeker approves or rejects.
3. Rejection does not capture payment and returns the engagement for correction.
4. Approval triggers capture of the authorised amount, subject to gateway limits and authorisation validity.
5. Backend verifies the final transaction status through a signed notification and/or server-to-server query.
6. Mark payment as CAPTURED/PAID only after authoritative confirmation. A browser/app return URL is not proof of payment.
7. If capture fails or the authorisation has expired, mark the payment for retry/re-authorisation and notify the Seeker. Do not mark it paid or settle the Provider.

### E. Provider settlement

- Customer card capture and Provider payout are distinct financial events.
- After capture and any configured risk/chargeback checks, create a Provider payable for the agreed Provider amount.
- Calculate and record gross customer charge, gateway fees, AnySkill commission/fees, adjustments/refunds and Provider net payable as separate ledger entries.
- AnySkill initiates Provider payout using a separately approved payout rail/process. PayGate Gateway card acquiring does not, by itself, establish that it supports arbitrary Provider bank payouts.
- Track payout states such as PENDING, PROCESSING, PAID, FAILED and REVERSED; retain provider payout references and reconciliation evidence.
- Commission rate, assessment-fee treatment, payout timing, payout rail, minimum payout and refund/chargeback allocation remain configurable/open product decisions.

## Suggested payment state model

Keep payment state separate from job/engagement state.

- Payment method: SETUP_PENDING, ACTIVE, REQUIRES_UPDATE, REMOVED.
- Authorisation: NOT_REQUIRED, PENDING, AUTHORISED, DECLINED, EXPIRED, VOID_PENDING, VOIDED, RECONCILIATION_REQUIRED.
- Capture: NOT_READY, PENDING, CAPTURED, FAILED, REQUIRES_REAUTHORISATION, REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED.
- Provider payable: NOT_ELIGIBLE, PENDING, PROCESSING, PAID, FAILED, REVERSED.

Use immutable transaction/ledger records rather than overwriting financial history. Store gateway transaction IDs, idempotency keys, amount/currency, job and estimate version, timestamps, status transitions and redacted gateway response metadata. Never store CVV or full PAN.

## Security and reliability requirements

- Use PayGate-hosted/tokenised collection or a gateway-approved SDK that keeps raw card data out of AnySkill systems.
- Confirm PCI DSS responsibilities and scope with PayGate/acquirer; tokenisation reduces exposure but does not automatically remove all compliance obligations.
- Verify webhook/ITN signatures and transaction details; query the gateway server-to-server where supported.
- Validate merchant ID, transaction reference, amount, currency, status and expected job/payment association.
- Make authorisation, capture, void and refund operations idempotent.
- Persist inbound notifications before processing; handle duplicates, retries and out-of-order events.
- Never trust client-supplied payment status, redirect parameters or screenshots.
- Encrypt gateway tokens at rest, restrict access, redact logs, audit all financial actions and apply POPIA-aligned retention/access controls.
- Provide a reconciliation process for pending/unknown transactions and gateway-versus-ledger mismatches.
- Do not automatically capture more than the Seeker-approved authorised amount.

## PayGate Gateway verification required before implementation

The product choice is PayGate Gateway (the gateway product, not the PayFast Aggregation product). The exact merchant integration must be confirmed with PayGate before selecting APIs or building against assumed capabilities.

Obtain written confirmation and sandbox credentials for:

1. Saved-card/card-on-file tokenisation during profile setup and subsequent use of the token.
2. Whether initial card setup can verify/tokenise a card without charging it, and what customer consent/3-D Secure steps are required.
3. Merchant-initiated pre-authorisation using a stored credential after the Seeker approves an estimate.
4. Separate delayed capture after completion approval, including capture deadlines and partial capture support.
5. Incremental authorisation or re-authorisation for approved additional hours.
6. Void/reversal of an uncaptured authorisation after cancellation, rejection, expiry or dispute.
7. Signed asynchronous notifications and server-side transaction query/reconciliation.
8. Whether PayGate offers a Provider payout product/API. If not, select a separate compliant payout rail.

Do not assume PayWeb3 and PayHost provide the same saved-card, authorisation, capture or token lifecycle. Do not begin production implementation until the actual merchant product and supported flow are confirmed.

## Implementation status

- **Product workflow:** Documented and approved.
- **Saved-card profile UI/API:** Not implemented.
- **PayGate credentials, merchant product and sandbox:** Not configured/confirmed.
- **Pre-authorisation and capture:** Not implemented.
- **Additional authorisation, void/refund and reconciliation:** Not implemented.
- **Provider payout/settlement:** Not implemented.
- **Live payment testing:** Not performed.
