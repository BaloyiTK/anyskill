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

      return tx.paymentOperation.create({
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
        if (![PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED].includes(payment.status)
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
