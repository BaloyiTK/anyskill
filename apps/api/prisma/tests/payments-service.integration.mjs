import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, PaymentOperationType, PaymentOperationStatus, PaymentStatus, LedgerDirection } from "@prisma/client";
import { PaymentsService } from "../../dist/payments/payments.service.js";

const prisma = new PrismaClient();
const payments = new PaymentsService(prisma);

before(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must point to a disposable test database.");
  await prisma.$connect();
});

after(async () => {
  await prisma.$disconnect();
});

async function createPaymentFixture() {
  const suffix = randomUUID();
  const seeker = await prisma.user.create({
    data: {
      email: `payment-seeker-${suffix}@example.invalid`,
      passwordHash: "integration-test-only",
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  const provider = await prisma.user.create({
    data: {
      email: `payment-provider-${suffix}@example.invalid`,
      passwordHash: "integration-test-only",
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  const request = await prisma.serviceRequest.create({
    data: {
      seekerId: seeker.id,
      title: "Payment integration fixture",
      skillCategory: "Plumbing",
      description: "Disposable payment service test fixture",
      deliveryMode: "REMOTE",
    },
    select: { id: true },
  });
  const response = await prisma.providerResponse.create({
    data: { requestId: request.id, providerId: provider.id },
    select: { id: true },
  });
  const engagement = await prisma.jobEngagement.create({
    data: {
      requestId: request.id,
      responseId: response.id,
      seekerId: seeker.id,
      providerId: provider.id,
      hourlyRate: "250.00",
    },
    select: { id: true },
  });
  const payment = await prisma.payment.create({
    data: {
      engagementId: engagement.id,
      seekerId: seeker.id,
      providerId: provider.id,
      estimateVersion: 1,
      currency: "ZAR",
    },
    select: { id: true },
  });
  return payment.id;
}

const key = (prefix) => `${prefix}-${randomUUID()}`;

test("payment operation intents are serialized and idempotent", async () => {
  const paymentId = await createPaymentFixture();
  const input = {
    paymentId,
    type: PaymentOperationType.AUTHORIZE,
    amountMinor: 125000n,
    currency: "ZAR",
    idempotencyKey: key("authorize"),
  };

  const [first, replay] = await Promise.all([
    payments.createOperation(input),
    payments.createOperation(input),
  ]);
  assert.equal(first.id, replay.id);
  assert.equal(first.status, PaymentOperationStatus.PENDING);
  assert.equal((await prisma.payment.findUnique({ where: { id: paymentId } }))?.status, PaymentStatus.AUTHORIZATION_PENDING);

  await assert.rejects(
    payments.createOperation({ ...input, amountMinor: 125001n }),
    (error) => error?.getStatus?.() === 409,
  );

  const completed = await payments.recordVerifiedOperationResult({
    operationId: first.id,
    outcome: PaymentOperationStatus.SUCCEEDED,
    gatewayReference: key("gateway-auth"),
  });
  assert.equal(completed.status, PaymentOperationStatus.SUCCEEDED);
  assert.equal((await prisma.payment.findUnique({ where: { id: paymentId } }))?.status, PaymentStatus.AUTHORIZED);

  const repeatedResult = await payments.recordVerifiedOperationResult({
    operationId: first.id,
    outcome: PaymentOperationStatus.SUCCEEDED,
    gatewayReference: completed.gatewayReference,
  });
  assert.equal(repeatedResult.id, first.id);
  await assert.rejects(
    payments.recordVerifiedOperationResult({
      operationId: first.id,
      outcome: PaymentOperationStatus.FAILED,
      failureCode: "DECLINED",
    }),
    (error) => error?.getStatus?.() === 409,
  );
});

test("ambiguous gateway outcomes require reconciliation before payment can proceed", async () => {
  const paymentId = await createPaymentFixture();
  const operation = await payments.createOperation({
    paymentId,
    type: PaymentOperationType.AUTHORIZE,
    amountMinor: 7500n,
    currency: "ZAR",
    idempotencyKey: key("authorize"),
  });

  await payments.recordVerifiedOperationResult({
    operationId: operation.id,
    outcome: PaymentOperationStatus.UNKNOWN,
  });
  assert.equal((await prisma.payment.findUnique({ where: { id: paymentId } }))?.status, PaymentStatus.RECONCILIATION_REQUIRED);
  assert.equal((await prisma.paymentOperation.findUnique({ where: { id: operation.id } }))?.status, PaymentOperationStatus.UNKNOWN);

  await payments.recordVerifiedOperationResult({
    operationId: operation.id,
    outcome: PaymentOperationStatus.SUCCEEDED,
    gatewayReference: key("gateway-reconciled"),
  });
  assert.equal((await prisma.payment.findUnique({ where: { id: paymentId } }))?.status, PaymentStatus.AUTHORIZED);
  assert.equal((await prisma.paymentOperation.findUnique({ where: { id: operation.id } }))?.status, PaymentOperationStatus.SUCCEEDED);
});

test("capture and partial/full refund transitions preserve captured-value limits", async () => {
  const paymentId = await createPaymentFixture();
  const auth = await payments.createOperation({
    paymentId,
    type: PaymentOperationType.AUTHORIZE,
    amountMinor: 10000n,
    currency: "ZAR",
    idempotencyKey: key("authorize"),
  });
  await payments.recordVerifiedOperationResult({
    operationId: auth.id,
    outcome: PaymentOperationStatus.SUCCEEDED,
    gatewayReference: key("gateway-auth"),
  });

  const capture = await payments.createOperation({
    paymentId,
    type: PaymentOperationType.CAPTURE,
    amountMinor: 10000n,
    currency: "ZAR",
    idempotencyKey: key("capture"),
  });
  assert.equal((await prisma.payment.findUnique({ where: { id: paymentId } }))?.status, PaymentStatus.CAPTURE_PENDING);
  await payments.recordVerifiedOperationResult({
    operationId: capture.id,
    outcome: PaymentOperationStatus.SUCCEEDED,
    gatewayReference: key("gateway-capture"),
  });
  assert.equal((await prisma.payment.findUnique({ where: { id: paymentId } }))?.status, PaymentStatus.CAPTURED);

  const partial = await payments.createOperation({
    paymentId,
    type: PaymentOperationType.REFUND,
    amountMinor: 4000n,
    currency: "ZAR",
    idempotencyKey: key("refund"),
  });
  await payments.recordVerifiedOperationResult({
    operationId: partial.id,
    outcome: PaymentOperationStatus.SUCCEEDED,
    gatewayReference: key("gateway-refund"),
  });
  assert.equal((await prisma.payment.findUnique({ where: { id: paymentId } }))?.status, PaymentStatus.PARTIALLY_REFUNDED);

  const finalRefund = await payments.createOperation({
    paymentId,
    type: PaymentOperationType.REFUND,
    amountMinor: 6000n,
    currency: "ZAR",
    idempotencyKey: key("refund"),
  });
  await payments.recordVerifiedOperationResult({
    operationId: finalRefund.id,
    outcome: PaymentOperationStatus.SUCCEEDED,
    gatewayReference: key("gateway-refund"),
  });
  assert.equal((await prisma.payment.findUnique({ where: { id: paymentId } }))?.status, PaymentStatus.REFUNDED);

  await assert.rejects(
    payments.createOperation({
      paymentId,
      type: PaymentOperationType.REFUND,
      amountMinor: 1n,
      currency: "ZAR",
      idempotencyKey: key("refund"),
    }),
    (error) => error?.getStatus?.() === 409,
  );
});

test("balanced ledger groups are atomic, replay-safe, and reject imbalance", async () => {
  const paymentId = await createPaymentFixture();
  const input = {
    paymentId,
    idempotencyKey: key("ledger"),
    lines: [
      { accountCode: "CUSTOMER_FUNDS", direction: LedgerDirection.DEBIT, amountMinor: 10000n, currency: "ZAR", description: "Customer payment receivable" },
      { accountCode: "MERCHANT_CLEARING", direction: LedgerDirection.CREDIT, amountMinor: 10000n, currency: "ZAR", description: "Funds due from gateway" },
    ],
  };
  const entries = await payments.postBalancedLedgerGroup(input);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].entryGroupId, entries[1].entryGroupId);
  const replay = await payments.postBalancedLedgerGroup(input);
  assert.deepEqual(replay.map((entry) => entry.id).sort(), entries.map((entry) => entry.id).sort());

  await assert.rejects(
    payments.postBalancedLedgerGroup({
      ...input,
      idempotencyKey: key("ledger"),
      lines: [
        { ...input.lines[0], amountMinor: 10000n },
        { ...input.lines[1], amountMinor: 9999n },
      ],
    }),
    (error) => error?.getStatus?.() === 422,
  );
});
