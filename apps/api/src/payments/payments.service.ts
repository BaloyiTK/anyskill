import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  LedgerDirection,
  PaymentOperationStatus,
  PaymentOperationType,
  PaymentStatus,
  Prisma,
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service";

export interface CreatePaymentOperationInput {
  paymentId: string;
  type: PaymentOperationType;
  amountMinor: bigint;
  currency: string;
  idempotencyKey: string;
}


export interface RecordChecksumVerifiedPayGateNotifyInput {
  providerEventId: string;
  rawPayload: string;
  payload: {
    payRequestId: string;
    reference: string;
    transactionStatus: number;
    resultCode: number;
    authCode: string;
    currency: string;
    amountMinor: string;
    transactionId: string;
    riskIndicator?: string;
    payMethod?: string;
    payMethodDetail?: string;
  };
}

export interface RecordPaymentOperationResultInput {
  operationId: string;
  outcome: Exclude<PaymentOperationStatus, "PENDING">;
  gatewayReference?: string;
  failureCode?: string;
}

export interface LedgerLineInput {
  accountCode: string;
  direction: LedgerDirection;
  amountMinor: bigint;
  currency: string;
  description: string;
}

export interface PostLedgerGroupInput {
  paymentId?: string;
  idempotencyKey: string;
  lines: LedgerLineInput[];
}

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists a durable, idempotent operation intent. This method deliberately
   * does not contact a gateway or claim that money has moved.
   */
  async createOperation(input: CreatePaymentOperationInput) {
    this.validateOperationInput(input);
    const currency = input.currency.toUpperCase();
    const requestHash = createHash("sha256")
      .update([input.paymentId, input.type, input.amountMinor.toString(), currency].join("|"))
      .digest("hex");

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.paymentId}, 1))`;

      const existing = await tx.paymentOperation.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException("Idempotency key was already used for a different payment operation.");
        }
        return existing;
      }

      const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
      if (!payment) throw new NotFoundException("Payment record was not found.");
      if (payment.currency !== currency) {
        throw new UnprocessableEntityException("Operation currency does not match the payment currency.");
      }

      await this.assertOperationAllowed(tx, payment, input.type, input.amountMinor);

      const operation = await tx.paymentOperation.create({
        data: {
          paymentId: payment.id,
          type: input.type,
          amountMinor: input.amountMinor,
          currency,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          status: PaymentOperationStatus.PENDING,
        },
      });

      if (input.type === PaymentOperationType.AUTHORIZE) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.AUTHORIZATION_PENDING } });
      } else if (input.type === PaymentOperationType.CAPTURE) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.CAPTURE_PENDING } });
      } else if (input.type === PaymentOperationType.REFUND) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.REFUND_PENDING } });
      }
      return operation;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /**
   * Persists a PayWeb3 notification only after the caller has validated the
   * PayGate CHECKSUM. The normalized allowlist intentionally excludes VAULT_ID
   * and other token material. This method is not an HTTP endpoint.
   */
  async recordChecksumVerifiedPayGateNotify(input: RecordChecksumVerifiedPayGateNotifyInput) {
    if (!/^[A-Za-z0-9._:-]{1,255}$/.test(input.providerEventId)
      || !input.rawPayload
      || Buffer.byteLength(input.rawPayload, "utf8") > 65_536) {
      throw new UnprocessableEntityException("PayGate notification identity or payload size is invalid.");
    }
    const p = input.payload;
    if (!/^[A-Za-z0-9-]{1,36}$/.test(p.payRequestId)
      || !/^[A-Za-z0-9._:-]{1,110}$/.test(p.reference)
      || !Number.isInteger(p.transactionStatus)
      || !Number.isInteger(p.resultCode)
      || !/^[A-Za-z0-9]{1,10}$/.test(p.authCode)
      || !/^[A-Z]{3}$/.test(p.currency)
      || !/^[0-9]{1,18}$/.test(p.amountMinor)
      || !/^[0-9]{1,20}$/.test(p.transactionId)
      || (p.riskIndicator !== undefined && p.riskIndicator.length > 10)
      || (p.payMethod !== undefined && p.payMethod.length > 5)
      || (p.payMethodDetail !== undefined && p.payMethodDetail.length > 45)) {
      throw new UnprocessableEntityException("PayGate notification fields are invalid.");
    }

    const payloadHash = createHash("sha256").update(input.rawPayload, "utf8").digest("hex");
    const normalizedPayload: Prisma.InputJsonObject = {
      payRequestId: p.payRequestId,
      reference: p.reference,
      transactionStatus: p.transactionStatus,
      resultCode: p.resultCode,
      authCode: p.authCode,
      currency: p.currency,
      amountMinor: p.amountMinor,
      transactionId: p.transactionId,
      ...(p.riskIndicator !== undefined ? { riskIndicator: p.riskIndicator } : {}),
      ...(p.payMethod !== undefined ? { payMethod: p.payMethod } : {}),
      ...(p.payMethodDetail !== undefined ? { payMethodDetail: p.payMethodDetail } : {}),
    };

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.providerEventId}, 3))`;
      const existing = await tx.paymentWebhookEvent.findUnique({
        where: { provider_providerEventId: { provider: "PAYGATE_PAYWEB3", providerEventId: input.providerEventId } },
      });
      if (existing) {
        if (existing.payloadHash !== payloadHash || !existing.signatureVerified) {
          throw new ConflictException("PayGate event ID was already received with different or unverified content.");
        }
        return existing;
      }

      return tx.paymentWebhookEvent.create({
        data: {
          provider: "PAYGATE_PAYWEB3",
          providerEventId: input.providerEventId,
          payloadHash,
          normalizedPayload,
          signatureVerified: true,
          status: "RECEIVED",
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /**
   * Records an authoritative result received only after a verified gateway
   * notification or a server-to-server gateway query. Never call this from a
   * browser redirect or client-supplied payment status.
   */
  async recordVerifiedOperationResult(input: RecordPaymentOperationResultInput) {
    if (!input.operationId || input.operationId.length > 36) {
      throw new UnprocessableEntityException("A valid payment operation ID is required.");
    }
    if (input.gatewayReference && input.gatewayReference.length > 255) {
      throw new UnprocessableEntityException("Gateway reference is too long.");
    }
    if (input.outcome === PaymentOperationStatus.SUCCEEDED && !input.gatewayReference) {
      throw new UnprocessableEntityException("A successful gateway result must include its transaction reference.");
    }
    if (input.failureCode && !/^[A-Za-z0-9_.:-]{1,100}$/.test(input.failureCode)) {
      throw new UnprocessableEntityException("Gateway failure code is invalid.");
    }

    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.paymentOperation.findUnique({
        where: { id: input.operationId },
        include: { payment: true },
      });
      if (!initial) throw new NotFoundException("Payment operation was not found.");

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${initial.paymentId}, 1))`;
      const operation = await tx.paymentOperation.findUnique({
        where: { id: input.operationId },
        include: { payment: true },
      });
      if (!operation) throw new NotFoundException("Payment operation was not found.");

      if (operation.status !== PaymentOperationStatus.PENDING
        && operation.status !== PaymentOperationStatus.UNKNOWN) {
        const sameResult = operation.status === input.outcome
          && operation.gatewayReference === (input.gatewayReference ?? null)
          && operation.failureCode === (input.failureCode ?? null);
        if (!sameResult) {
          throw new ConflictException("Payment operation already has a different terminal result.");
        }
        return operation;
      }

      if (operation.payment.status === PaymentStatus.RECONCILIATION_REQUIRED
        && input.outcome !== PaymentOperationStatus.UNKNOWN) {
        // A verified, authoritative result resolves an earlier ambiguous outcome.
      } else if (operation.payment.status === PaymentStatus.RECONCILIATION_REQUIRED
        && input.outcome === PaymentOperationStatus.UNKNOWN) {
        return operation;
      }

      const now = new Date();
      const paymentUpdate: Prisma.PaymentUpdateInput = {};
      if (input.outcome === PaymentOperationStatus.UNKNOWN) {
        paymentUpdate.status = PaymentStatus.RECONCILIATION_REQUIRED;
      } else if (input.outcome === PaymentOperationStatus.FAILED) {
        if (operation.type === PaymentOperationType.AUTHORIZE) {
          paymentUpdate.status = PaymentStatus.FAILED;
        } else if (operation.type === PaymentOperationType.CAPTURE
          || operation.type === PaymentOperationType.VOID) {
          paymentUpdate.status = PaymentStatus.AUTHORIZED;
        } else {
          const priorRefunds = await tx.paymentOperation.aggregate({
            where: {
              paymentId: operation.paymentId,
              type: PaymentOperationType.REFUND,
              status: PaymentOperationStatus.SUCCEEDED,
              id: { not: operation.id },
            },
            _sum: { amountMinor: true },
          });
          paymentUpdate.status = (priorRefunds._sum.amountMinor ?? 0n) > 0n
            ? PaymentStatus.PARTIALLY_REFUNDED
            : PaymentStatus.CAPTURED;
        }
      } else {
        switch (operation.type) {
          case PaymentOperationType.AUTHORIZE:
            if (operation.payment.status !== PaymentStatus.PENDING
              && operation.payment.status !== PaymentStatus.AUTHORIZATION_PENDING
              && operation.payment.status !== PaymentStatus.RECONCILIATION_REQUIRED) {
              throw new ConflictException("Payment is not in a state that can accept an authorization result.");
            }
            paymentUpdate.status = PaymentStatus.AUTHORIZED;
            paymentUpdate.amountAuthorizedMinor = operation.amountMinor;
            paymentUpdate.authorizedAt = now;
            break;
          case PaymentOperationType.CAPTURE:
            if (operation.payment.status !== PaymentStatus.AUTHORIZED
              && operation.payment.status !== PaymentStatus.CAPTURE_PENDING
              && operation.payment.status !== PaymentStatus.RECONCILIATION_REQUIRED) {
              throw new ConflictException("Payment is not in a state that can accept a capture result.");
            }
            paymentUpdate.status = PaymentStatus.CAPTURED;
            paymentUpdate.amountCapturedMinor = operation.amountMinor;
            paymentUpdate.capturedAt = now;
            break;
          case PaymentOperationType.VOID:
            if (operation.payment.status !== PaymentStatus.AUTHORIZED
              && operation.payment.status !== PaymentStatus.RECONCILIATION_REQUIRED) {
              throw new ConflictException("Payment is not in a state that can accept a void result.");
            }
            paymentUpdate.status = PaymentStatus.CANCELLED;
            break;
          case PaymentOperationType.REFUND: {
            if (operation.payment.status !== PaymentStatus.REFUND_PENDING
              && operation.payment.status !== PaymentStatus.RECONCILIATION_REQUIRED) {
              throw new ConflictException("Payment is not in a state that can accept a refund result.");
            }
            if (operation.payment.amountCapturedMinor === null) {
              throw new ConflictException("Captured amount is missing; refund result requires reconciliation.");
            }
            const priorRefunds = await tx.paymentOperation.aggregate({
              where: {
                paymentId: operation.paymentId,
                type: PaymentOperationType.REFUND,
                status: PaymentOperationStatus.SUCCEEDED,
                id: { not: operation.id },
              },
              _sum: { amountMinor: true },
            });
            const totalRefunded = (priorRefunds._sum.amountMinor ?? 0n) + operation.amountMinor;
            if (totalRefunded > operation.payment.amountCapturedMinor) {
              throw new ConflictException("Confirmed refunds exceed the captured amount; manual reconciliation is required.");
            }
            paymentUpdate.status = totalRefunded === operation.payment.amountCapturedMinor
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED;
            break;
          }
        }
      }

      const updatedOperation = await tx.paymentOperation.update({
        where: { id: operation.id },
        data: {
          status: input.outcome,
          ...(input.gatewayReference ? { gatewayReference: input.gatewayReference } : {}),
          failureCode: input.outcome === PaymentOperationStatus.FAILED
            ? input.failureCode ?? "GATEWAY_DECLINED"
            : null,
          completedAt: input.outcome === PaymentOperationStatus.UNKNOWN ? null : now,
        },
      });
      await tx.payment.update({
        where: { id: operation.paymentId },
        data: paymentUpdate,
      });
      return updatedOperation;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /**
   * Posts a complete balanced journal group atomically. Existing ledger rows
   * are immutable; a correction must be a new compensating group.
   */
  async postBalancedLedgerGroup(input: PostLedgerGroupInput) {
    this.validateLedgerGroup(input);
    const normalizedLines = input.lines.map((line) => ({
      ...line,
      currency: line.currency.toUpperCase(),
    }));

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 2))`;

      const expectedKeys = normalizedLines.map((_, index) => `${input.idempotencyKey}:${index}`);
      const existing = await tx.financialLedgerEntry.findMany({
        where: { idempotencyKey: { in: expectedKeys } },
        orderBy: { createdAt: "asc" },
      });
      if (existing.length > 0) {
        const matches = existing.length === normalizedLines.length
          && normalizedLines.every((line, index) => {
            const row = existing.find((entry) => entry.idempotencyKey === expectedKeys[index]);
            return row
              && row.accountCode === line.accountCode
              && row.direction === line.direction
              && row.amountMinor === line.amountMinor
              && row.currency === line.currency
              && row.paymentId === (input.paymentId ?? null)
              && row.description === line.description;
          });
        if (!matches) {
          throw new ConflictException("Ledger idempotency key was already used for a different journal group.");
        }
        return existing;
      }

      if (input.paymentId) {
        const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, select: { id: true } });
        if (!payment) throw new NotFoundException("Payment record was not found.");
      }

      const entryGroupId = randomUUID();
      await tx.financialLedgerEntry.createMany({
        data: normalizedLines.map((line, index) => ({
          entryGroupId,
          paymentId: input.paymentId ?? null,
          accountCode: line.accountCode,
          direction: line.direction,
          amountMinor: line.amountMinor,
          currency: line.currency,
          idempotencyKey: expectedKeys[index]!,
          description: line.description,
        })),
      });
      return tx.financialLedgerEntry.findMany({
        where: { entryGroupId },
        orderBy: { id: "asc" },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private async assertOperationAllowed(
    tx: Prisma.TransactionClient,
    payment: { id: string; status: PaymentStatus; amountAuthorizedMinor: bigint | null; amountCapturedMinor: bigint | null },
    type: PaymentOperationType,
    amountMinor: bigint,
  ): Promise<void> {
    const pending = await tx.paymentOperation.findMany({
      where: { paymentId: payment.id, status: { in: [PaymentOperationStatus.PENDING, PaymentOperationStatus.UNKNOWN] } },
      select: { type: true, amountMinor: true },
    });

    if (pending.length > 0) {
      throw new ConflictException("A payment operation is already pending reconciliation for this payment.");
    }

    switch (type) {
      case PaymentOperationType.AUTHORIZE:
        if (payment.status !== PaymentStatus.PENDING || payment.amountAuthorizedMinor !== null) {
          throw new ConflictException("This payment is not eligible for a new authorization.");
        }
        break;
      case PaymentOperationType.CAPTURE:
        if (payment.status !== PaymentStatus.AUTHORIZED || payment.amountAuthorizedMinor === null
          || amountMinor > payment.amountAuthorizedMinor || payment.amountCapturedMinor !== null) {
          throw new ConflictException("Capture amount or payment state is not eligible.");
        }
        break;
      case PaymentOperationType.VOID:
        if (payment.status !== PaymentStatus.AUTHORIZED || payment.amountAuthorizedMinor !== amountMinor) {
          throw new ConflictException("Only the full outstanding authorization can be voided.");
        }
        break;
      case PaymentOperationType.REFUND: {
        if ((payment.status !== PaymentStatus.CAPTURED && payment.status !== PaymentStatus.PARTIALLY_REFUNDED)
          || payment.amountCapturedMinor === null) {
          throw new ConflictException("This payment is not eligible for a refund.");
        }
        const refunded = await tx.paymentOperation.aggregate({
          where: { paymentId: payment.id, type: PaymentOperationType.REFUND, status: PaymentOperationStatus.SUCCEEDED },
          _sum: { amountMinor: true },
        });
        const remaining = payment.amountCapturedMinor - (refunded._sum.amountMinor ?? 0n);
        if (amountMinor > remaining) {
          throw new ConflictException("Refund amount exceeds the remaining captured balance.");
        }
        break;
      }
    }
  }

  private validateOperationInput(input: CreatePaymentOperationInput): void {
    if (!input.paymentId || input.paymentId.length > 36) {
      throw new UnprocessableEntityException("A valid payment ID is required.");
    }
    if (input.amountMinor <= 0n) {
      throw new UnprocessableEntityException("Payment operation amount must be positive.");
    }
    if (!/^[A-Z]{3}$/.test(input.currency)) {
      throw new UnprocessableEntityException("Currency must be a three-letter ISO code.");
    }
    if (!/^[A-Za-z0-9._:-]{16,120}$/.test(input.idempotencyKey)) {
      throw new UnprocessableEntityException("Idempotency key must be 16–120 safe characters.");
    }
  }

  private validateLedgerGroup(input: PostLedgerGroupInput): void {
    if (!/^[A-Za-z0-9._:-]{16,120}$/.test(input.idempotencyKey)) {
      throw new UnprocessableEntityException("Ledger idempotency key must be 16–120 safe characters.");
    }
    if (!Array.isArray(input.lines) || input.lines.length < 2 || input.lines.length > 20) {
      throw new UnprocessableEntityException("A ledger group must contain between 2 and 20 entries.");
    }

    const totals = new Map<string, { debit: bigint; credit: bigint }>();
    for (const line of input.lines) {
      if (!/^[A-Z0-9_.:-]{2,80}$/.test(line.accountCode)
        || (line.direction !== LedgerDirection.DEBIT && line.direction !== LedgerDirection.CREDIT)
        || !/^[A-Z]{3}$/.test(line.currency)
        || !line.description.trim()
        || line.description.length > 500
        || line.amountMinor <= 0n) {
        throw new UnprocessableEntityException("Ledger entry contains invalid account, currency, description, or amount.");
      }
      const currency = line.currency.toUpperCase();
      const total = totals.get(currency) ?? { debit: 0n, credit: 0n };
      if (line.direction === LedgerDirection.DEBIT) total.debit += line.amountMinor;
      else total.credit += line.amountMinor;
      totals.set(currency, total);
    }

    if ([...totals.values()].some((total) => total.debit !== total.credit)) {
      throw new UnprocessableEntityException("Every currency in a ledger group must balance debits and credits.");
    }
  }
}
