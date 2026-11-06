# AnySkill job completion workflow

## Agreed lifecycle

1. A Skill Seeker selects a Provider offer.
2. The Provider assesses the work and submits estimated hours and notes.
3. The Seeker approves or rejects the estimate. Work cannot start before approval.
4. The Provider starts the approved job.
5. Any additional hours require a separate reason, price calculation and Seeker approval before that extra work is performed.
6. When the agreed work is finished, the Provider submits completion notes and photo evidence.
7. The Seeker reviews the submission and either approves it or rejects it with a correction reason.
8. Approval marks the engagement and service request COMPLETED. Rejection returns the engagement to IN_PROGRESS so the Provider can correct and resubmit.

## Completion rules implemented

- Only the selected Provider can submit completion.
- The engagement must be IN_PROGRESS.
- Pending additional-hours decisions block completion submission.
- At least one evidence URL and completion notes are required.
- Evidence URLs must be HTTPS and are limited to eight per submission.
- Only the owning Skill Seeker can review a submission.
- Rejection requires a reason.
- The Provider is notified of approval or requested corrections.
- Completion approval does not trigger or imply payment collection, escrow release or payout.

## Current evidence storage limitation

The API currently stores HTTPS evidence image URLs and the mobile screen accepts one URL per line. It does **not** yet upload binary photo files from the device or provide durable object storage. Before production, AnySkill must choose and configure a persistent media-storage provider, then add authenticated upload/presigned-upload flows, file-size and MIME validation, malware/content checks as appropriate, access controls and retention rules. Do not treat arbitrary user-provided URLs as verified evidence or expose private storage objects publicly.

## API endpoints

- `POST /api/v1/marketplace/requests/:requestId/completion` — Provider submits notes and evidence URLs.
- `POST /api/v1/marketplace/requests/:requestId/completion/:submissionId/decision` — Seeker approves or rejects.
- `GET /api/v1/marketplace/my-jobs` — Provider job list includes completion submissions.
- `GET /api/v1/marketplace/my-requests` — Seeker request list includes completion submissions.

Identity verification is enforced server-side on completion submission and review actions. Payment and dispute handling remain separate workflows.
