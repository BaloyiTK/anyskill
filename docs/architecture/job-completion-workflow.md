# AnySkill job assessment, completion and payment hand-off

## Agreed job lifecycle

1. A Skill Seeker selects a Provider offer.
2. The Provider assesses the work and submits estimated hours and notes. The agreed hourly rate is used to calculate the estimate; the assessment fee is disclosed and agreed separately.
3. The Seeker approves or rejects the estimate. Work cannot start before approval.
4. After estimate approval, AnySkill must successfully pre-authorise the estimated job amount against the Seeker's saved PayGate payment method. The Provider must not be instructed to start until the backend confirms the authorisation.
5. The Provider starts the authorised job.
6. Any additional hours require a reason, price calculation, Seeker approval and a successful incremental/additional authorisation before that extra work is performed. If the gateway cannot safely increase or extend an authorisation, AnySkill must obtain a new authorisation or require another supported payment arrangement before the extra work starts.
7. When the agreed work is finished, the Provider submits completion notes and photo evidence.
8. The Seeker reviews the submission and either approves it or rejects it with a correction reason.
9. Approval marks the engagement and service request COMPLETED and triggers capture of the authorised payment. The backend must verify the final gateway result before marking the payment as collected.
10. Rejection returns the engagement to IN_PROGRESS so the Provider can correct and resubmit. It does not trigger capture.
11. Once payment capture is confirmed, the Provider's net amount becomes eligible for the separate AnySkill settlement process.

## Completion rules implemented

- Only the selected Provider can submit completion.
- The engagement must be IN_PROGRESS.
- Pending additional-hours decisions block completion submission.
- Completion notes and evidence assets are required.
- Completion evidence is uploaded to Cloudinary as authenticated image assets; submission attaches asset IDs, not arbitrary public URLs.
- Only the owning Skill Seeker can review a submission.
- Rejection requires a reason.
- The Provider is notified of approval or requested corrections.
- Completion approval currently marks the engagement and request COMPLETED and sends notifications. Payment capture is a required future integration and is not yet wired to this approval action.

## Payment boundary

- Estimate approval is not payment capture. It is the point at which AnySkill requests card pre-authorisation.
- Work may start only after successful authorisation is confirmed server-side.
- Seeker completion approval is the capture trigger. Do not capture when the Provider merely submits evidence.
- A failed or uncertain capture must enter a retry/reconciliation state; do not tell either party that payment succeeded based only on a mobile redirect.
- If completion is rejected, do not capture. Keep the agreed correction workflow active and apply the gateway's authorisation expiry/void rules.
- Provider settlement is separate from gateway card capture. A captured customer payment does not itself prove that the Provider has been paid.
- See `payment-and-settlement-workflow.md` for saved-card setup, state transitions, additional-hours handling, refunds, reconciliation and open PayGate decisions.

## API endpoints currently implemented

- `POST /api/v1/marketplace/requests/:requestId/completion` — Provider submits completion notes and evidence asset IDs.
- `POST /api/v1/marketplace/requests/:requestId/completion/:submissionId/decision` — Seeker approves or rejects.
- `GET /api/v1/marketplace/my-jobs` — Provider job list includes completion submissions.
- `GET /api/v1/marketplace/my-requests` — Seeker request list includes completion submissions.

Identity verification is enforced server-side on completion submission and review actions. Payment authorisation, capture, refund handling and Provider settlement are not yet implemented.
