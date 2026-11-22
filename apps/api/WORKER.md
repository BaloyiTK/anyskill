# Marketplace background worker deployment

The API and marketplace worker are separate runtime processes in production.

## API service

Set:

```env
MARKETPLACE_WORKER_ENABLED=false
```

Run the normal API command:

```sh
pnpm --filter @anyskill/api start:prod
```

## Marketplace worker service

Deploy a second service from the same build and release. Give it the same database, SMTP, Expo and other required runtime environment variables as the API. Run:

```sh
pnpm --filter @anyskill/api start:worker
```

The worker entrypoint enables the marketplace poller and runs the persisted matching, push-delivery, receipt and welcome-email retry cycles. Keep at least one worker replica running. The database compare-and-set claims and row locks prevent overlapping workers from claiming the same notification or request wave.

Do not set `MARKETPLACE_WORKER_ENABLED=false` on the worker service. Do not run the worker command in the API container as a second copy of the API process.

## Operational checks

- Apply Prisma migrations before deploying the new API and worker build.
- Monitor worker logs for cycle failures, retry exhaustion and SMTP/Expo errors.
- Alert when the worker process is stopped or repeatedly fails to complete cycles.
- The outbox provides durable, retryable delivery; SMTP cannot provide strict exactly-once delivery if a process crashes after the mail server accepts a message but before the database records success.
