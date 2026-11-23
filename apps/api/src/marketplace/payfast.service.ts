import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../database/prisma.service";

type PayFastConfig = {
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  publicApiUrl: string;
  returnUrl: string;
  cancelUrl: string;
  sandboxHost: string;
};

type PayFastItn = Record<string, string | undefined>;

const PAYFAST_IP_RANGES = [
  "197.97.145.144/28",
  "41.74.179.192/27",
  "102.216.36.0/28",
  "102.216.36.128/28",
  "144.126.193.139/32",
];

@Injectable()
export class PayFastService {
  constructor(private readonly prisma: PrismaService) {}

  private config(): PayFastConfig {
    if ((process.env.PAYFAST_MODE ?? "sandbox").trim().toLowerCase() !== "sandbox") {
      throw new ServiceUnavailableException("Only PayFast sandbox mode is enabled in this AnySkill build.");
    }
    const merchantId = process.env.PAYFAST_MERCHANT_ID?.trim();
    const merchantKey = process.env.PAYFAST_MERCHANT_KEY?.trim();
    const passphrase = process.env.PAYFAST_PASSPHRASE;
    const publicApiUrl = process.env.PAYFAST_PUBLIC_API_URL?.trim().replace(/\/$/, "");
    const returnUrl = process.env.PAYFAST_RETURN_URL?.trim();
    const cancelUrl = process.env.PAYFAST_CANCEL_URL?.trim();
    if (!merchantId || !merchantKey || !passphrase || !publicApiUrl || !returnUrl || !cancelUrl) {
      throw new ServiceUnavailableException("PayFast sandbox is not configured. Set the PAYFAST_* environment variables on the API.");
    }
    if (!/^\d{8}$/.test(merchantId)) throw new ServiceUnavailableException("PAYFAST_MERCHANT_ID must be the 8-digit sandbox merchant ID.");
    if (!/^https:\/\//i.test(publicApiUrl) || !/^https:\/\//i.test(returnUrl) || !/^https:\/\//i.test(cancelUrl)) {
      throw new ServiceUnavailableException("PayFast public API, return and cancel URLs must use HTTPS.");
    }
    return {
      merchantId, merchantKey, passphrase, publicApiUrl, returnUrl, cancelUrl,
      sandboxHost: "https://sandbox.payfast.co.za",
    };
  }

  private tokenKey(): Buffer {
    const secret = process.env.PAYFAST_TOKEN_ENCRYPTION_KEY?.trim();
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException("PAYFAST_TOKEN_ENCRYPTION_KEY must contain at least 32 characters before saved-card payments can be enabled.");
    }
    return createHash("sha256").update(secret, "utf8").digest();
  }

  private encryptToken(token: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.tokenKey(), iv);
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return {
      encryptedToken: encrypted.toString("base64"),
      tokenIv: iv.toString("hex"),
      tokenAuthTag: cipher.getAuthTag().toString("hex"),
    };
  }

  private decryptToken(record: { encryptedToken: string; tokenIv: string; tokenAuthTag: string }): string {
    const decipher = createDecipheriv("aes-256-gcm", this.tokenKey(), Buffer.from(record.tokenIv, "hex"));
    decipher.setAuthTag(Buffer.from(record.tokenAuthTag, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(record.encryptedToken, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  private phpUrlEncode(value: string): string {
    return encodeURIComponent(value)
      .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
      .replace(/%20/g, "+");
  }

  private formSignature(fields: Record<string, string>, passphrase: string): string {
    const parts = Object.entries(fields)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => `${key}=${this.phpUrlEncode(value)}`);
    parts.push(`passphrase=${this.phpUrlEncode(passphrase)}`);
    return createHash("md5").update(parts.join("&"), "utf8").digest("hex");
  }

  private apiSignature(values: Record<string, string>, passphrase: string): string {
    const fields = { ...values, passphrase };
    const encoded = Object.keys(fields).sort().map((key) => `${key}=${this.phpUrlEncode(fields[key])}`).join("&");
    return createHash("md5").update(encoded, "utf8").digest("hex");
  }

  private async getPayableJob(seekerId: string, requestId: string) {
    const job = await this.prisma.jobEngagement.findUnique({
      where: { requestId },
      include: { request: { include: { seeker: { select: { email: true } } } } },
    });
    if (!job) throw new NotFoundException("Selected job not found.");
    if (job.seekerId !== seekerId) throw new ForbiddenException("Only the Skill Seeker assigned to this job can pay.");
    if (job.status !== "COMPLETED" || job.finalAmountDue === null) {
      throw new ConflictException("The Provider's completion must be approved before payment.");
    }
    if (!job.providerId) throw new ConflictException("This completed job has no assigned Provider and cannot be paid.");
    if (job.paymentStatus !== "UNPAID" && job.paymentStatus !== "PAYFAST_PENDING") {
      throw new ConflictException("This job already has a payment recorded or is being processed.");
    }
    if (Number(job.finalAmountDue) < 5) {
      throw new BadRequestException("PayFast requires a minimum payment of R5.00.");
    }
    return job;
  }

  async createJobCheckout(seekerId: string, requestId: string, saveCard: boolean) {
    const config = this.config();
    if (saveCard) this.tokenKey();
    const job = await this.getPayableJob(seekerId, requestId);
    const existing = await this.prisma.payFastCheckout.findFirst({
      where: { engagementId: job.id, status: "PENDING", createdAt: { gte: new Date(Date.now() - 20 * 60 * 1000) } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      return {
        checkoutUrl: `${config.publicApiUrl}/api/v1/marketplace/payments/payfast/checkout/${existing.merchantPaymentId}`,
        merchantPaymentId: existing.merchantPaymentId,
        amount: existing.amount.toFixed(2),
        saveCard: existing.saveCard,
        mode: "PAYFAST_SANDBOX",
      };
    }

    const merchantPaymentId = `AS-${cryptoRandomId()}`;
    const amount = job.finalAmountDue!;
    const checkout = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payFastCheckout.create({
        data: {
          userId: seekerId,
          engagementId: job.id,
          merchantPaymentId,
          mode: "SANDBOX",
          amount,
          currency: "ZAR",
          status: "PENDING",
          saveCard,
        },
      });
      await tx.jobEngagement.update({
        where: { id: job.id },
        data: { paymentStatus: "PAYFAST_PENDING" },
      });
      return created;
    });

    return {
      checkoutUrl: `${config.publicApiUrl}/api/v1/marketplace/payments/payfast/checkout/${checkout.merchantPaymentId}`,
      merchantPaymentId: checkout.merchantPaymentId,
      amount: checkout.amount.toFixed(2),
      saveCard,
      mode: "PAYFAST_SANDBOX",
    };
  }

  async getCheckoutHtml(merchantPaymentId: string): Promise<string> {
    const config = this.config();
    const checkout = await this.prisma.payFastCheckout.findUnique({
      where: { merchantPaymentId },
      include: { user: { select: { email: true } } },
    });
    if (!checkout || checkout.status !== "PENDING" || checkout.createdAt.getTime() < Date.now() - 30 * 60 * 1000) {
      throw new NotFoundException("This PayFast checkout has expired. Return to AnySkill and try again.");
    }
    const fields: Record<string, string> = {
      merchant_id: config.merchantId,
      merchant_key: config.merchantKey,
      return_url: config.returnUrl,
      cancel_url: config.cancelUrl,
      notify_url: `${config.publicApiUrl}/api/v1/marketplace/payments/payfast/itn`,
      email_address: checkout.user.email,
      m_payment_id: checkout.merchantPaymentId,
      amount: checkout.amount.toFixed(2),
      item_name: `AnySkill service ${checkout.merchantPaymentId}`.slice(0, 100),
      item_description: "AnySkill completed service payment",
    };
    if (checkout.saveCard) fields.subscription_type = "2";
    fields.signature = this.formSignature(fields, config.passphrase);
    const inputs = Object.entries(fields)
      .map(([name, value]) => `<input type="hidden" name="${this.escapeHtml(name)}" value="${this.escapeHtml(value)}">`)
      .join("");
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Secure PayFast checkout</title></head><body><main><p>Redirecting securely to PayFast…</p><form id="payfast" action="${config.sandboxHost}/eng/process" method="post">${inputs}<button type="submit">Continue to PayFast</button></form></main><script>document.getElementById("payfast").submit();</script></body></html>`;
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]!);
  }

  async listSavedPaymentMethods(userId: string) {
    return this.prisma.savedPaymentMethod.findMany({
      where: { userId, status: "ACTIVE" },
      select: { id: true, provider: true, cardBrand: true, lastFour: true, status: true, isDefault: true, createdAt: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
  }

  async removeSavedPaymentMethod(userId: string, methodId: string) {
    const result = await this.prisma.savedPaymentMethod.updateMany({
      where: { id: methodId, userId, status: "ACTIVE" },
      data: { status: "REVOKED", isDefault: false },
    });
    if (result.count !== 1) throw new NotFoundException("Saved payment method not found.");
    return { success: true };
  }

  async chargeSavedCard(seekerId: string, requestId: string, paymentMethodId: string) {
    const config = this.config();
    const job = await this.getPayableJob(seekerId, requestId);
    const method = await this.prisma.savedPaymentMethod.findFirst({
      where: { id: paymentMethodId, userId: seekerId, provider: "PAYFAST", status: "ACTIVE" },
    });
    if (!method) throw new NotFoundException("Saved card not found. Choose another payment method.");
    const token = this.decryptToken(method);
    const merchantPaymentId = `AS-${cryptoRandomId()}`;
    const amount = job.finalAmountDue!;
    const checkout = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payFastCheckout.create({
        data: { userId: seekerId, engagementId: job.id, merchantPaymentId, mode: "SANDBOX", amount, status: "PENDING" },
      });
      await tx.jobEngagement.update({ where: { id: job.id }, data: { paymentStatus: "PAYFAST_PENDING" } });
      return created;
    });

    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
    const body: Record<string, string> = {
      amount: String(Math.round(Number(amount) * 100)),
      item_name: `AnySkill service ${merchantPaymentId}`.slice(0, 100),
      item_description: "AnySkill completed service payment",
      itn: "true",
      m_payment_id: merchantPaymentId,
    };
    const signedValues = { ...body, "merchant-id": config.merchantId, version: "v1", timestamp };
    const signature = this.apiSignature(signedValues, config.passphrase);
    const response = await fetch(`https://api.payfast.co.za/subscriptions/${encodeURIComponent(token)}/adhoc?testing=true`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "merchant-id": config.merchantId,
        version: "v1",
        timestamp,
        signature,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    }).catch(async () => null);

    if (!response) {
      return { success: true, status: "PENDING_CONFIRMATION", merchantPaymentId, amount: amount.toFixed(2), mode: "PAYFAST_SANDBOX" };
    }
    const payload = await response.json().catch(() => ({})) as {
      status?: string; data?: { response?: boolean | number; message?: string; pf_payment_id?: string };
    };
    if (!response.ok || payload.data?.response !== true) {
      await this.prisma.$transaction(async (tx) => {
        await tx.payFastCheckout.update({ where: { id: checkout.id }, data: { status: "FAILED", failedAt: new Date(), failureReason: "PayFast token charge was not accepted." } });
        await tx.jobEngagement.updateMany({ where: { id: job.id, paymentStatus: "PAYFAST_PENDING" }, data: { paymentStatus: "UNPAID" } });
      });
      throw new BadGatewayException("PayFast could not accept the saved-card payment. No successful payment has been recorded.");
    }
    if (payload.data.pf_payment_id) {
      await this.prisma.payFastCheckout.update({
        where: { id: checkout.id },
        data: { externalPaymentId: String(payload.data.pf_payment_id) },
      });
    }
    return { success: true, status: "PENDING_CONFIRMATION", merchantPaymentId, amount: amount.toFixed(2), mode: "PAYFAST_SANDBOX" };
  }

  private ipv4Number(address: string): number | null {
    const parts = address.replace(/^::ffff:/, "").split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
    return parts.reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
  }

  private isAllowedPayFastIp(address: string): boolean {
    const ip = this.ipv4Number(address);
    if (ip === null) return false;
    return PAYFAST_IP_RANGES.some((range) => {
      const [network, prefixText] = range.split("/");
      const prefix = Number(prefixText);
      const networkIp = this.ipv4Number(network);
      if (networkIp === null) return false;
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      return (ip & mask) === (networkIp & mask);
    });
  }

  private safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left.toLowerCase(), "utf8");
    const b = Buffer.from(right.toLowerCase(), "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async validateItnWithPayFast(body: PayFastItn, config: PayFastConfig): Promise<boolean> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (key !== "signature" && value !== undefined) params.append(key, value);
    }
    const response = await fetch(`${config.sandboxHost}/eng/query/validate`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!response?.ok) return false;
    return (await response.text()).trim() === "VALID";
  }

  async handleItn(body: PayFastItn, sourceIp: string) {
    const config = this.config();
    if (!sourceIp || !this.isAllowedPayFastIp(sourceIp)) {
      throw new ForbiddenException("PayFast notification source IP is not allowed.");
    }
    const signature = body.signature;
    if (!signature) throw new BadRequestException("PayFast notification signature is missing.");
    const signatureFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (key !== "signature" && value !== undefined) signatureFields[key] = value;
    }
    if (!this.safeEqual(signature, this.formSignature(signatureFields, config.passphrase))) {
      throw new ForbiddenException("PayFast notification signature is invalid.");
    }
    if (body.merchant_id !== config.merchantId) throw new ForbiddenException("PayFast merchant ID does not match.");
    if (!(await this.validateItnWithPayFast(body, config))) {
      throw new ForbiddenException("PayFast could not validate this transaction notification.");
    }
    const merchantPaymentId = body.m_payment_id;
    if (!merchantPaymentId) throw new BadRequestException("PayFast merchant payment reference is missing.");
    const checkout = await this.prisma.payFastCheckout.findUnique({
      where: { merchantPaymentId },
      include: { engagement: true },
    });
    if (!checkout) throw new NotFoundException("PayFast checkout reference was not found.");
    if (checkout.status === "COMPLETE") return { success: true, duplicate: true };
    const gross = Number(body.amount_gross);
    if (!Number.isFinite(gross) || Math.abs(gross - Number(checkout.amount)) > 0.009) {
      throw new BadRequestException("PayFast amount does not match the AnySkill payment.");
    }

    if (body.payment_status !== "COMPLETE") {
      await this.prisma.$transaction(async (tx) => {
        await tx.payFastCheckout.update({ where: { id: checkout.id }, data: { status: "FAILED", failedAt: new Date(), failureReason: "PayFast reported a non-completed payment." } });
        await tx.jobEngagement.updateMany({ where: { id: checkout.engagementId, paymentStatus: "PAYFAST_PENDING" }, data: { paymentStatus: "UNPAID" } });
      });
      return { success: true, paymentStatus: "FAILED" };
    }

    const completedAt = new Date();
    const pfPaymentId = body.pf_payment_id ?? null;
    await this.prisma.$transaction(async (tx) => {
      const currentJob = await tx.jobEngagement.findUnique({ where: { id: checkout.engagementId } });
      if (!currentJob || (currentJob.paymentStatus !== "PAYFAST_PENDING" && currentJob.paymentStatus !== "UNPAID")) {
        throw new ConflictException("The job payment state has changed; PayFast confirmation needs reconciliation.");
      }
      await tx.jobEngagement.update({
        where: { id: checkout.engagementId },
        data: {
          paymentStatus: "PAYFAST_PAID",
          providerPayoutStatus: "PENDING",
          paymentSimulatedAt: null,
          providerPayoutSimulatedAt: null,
        },
      });
      await tx.payFastCheckout.update({
        where: { id: checkout.id },
        data: { status: "COMPLETE", externalPaymentId: pfPaymentId, completedAt },
      });
      await tx.jobFinancialTransaction.upsert({
        where: { engagementId_transactionType: { engagementId: checkout.engagementId, transactionType: "PROVIDER_PAYOUT" } },
        create: {
          engagementId: checkout.engagementId,
          transactionType: "PROVIDER_PAYOUT",
          mode: "PAYFAST_SANDBOX",
          status: "PENDING",
          amount: checkout.amount,
          currency: "ZAR",
          externalProvider: "PAYFAST",
          externalReference: pfPaymentId,
          idempotencyKey: `${checkout.engagementId}:PROVIDER_PAYOUT`,
          initiatedAt: completedAt,
        },
        update: {
          mode: "PAYFAST_SANDBOX",
          status: "PENDING",
          amount: checkout.amount,
          externalProvider: "PAYFAST",
          externalReference: pfPaymentId,
          initiatedAt: completedAt,
          completedAt: null,
          failedAt: null,
          failureReason: null,
        },
      });
      await tx.jobFinancialTransaction.upsert({
        where: { engagementId_transactionType: { engagementId: checkout.engagementId, transactionType: "SEEKER_PAYMENT" } },
        create: {
          engagementId: checkout.engagementId,
          transactionType: "SEEKER_PAYMENT",
          mode: "PAYFAST_SANDBOX",
          status: "COMPLETED",
          amount: checkout.amount,
          currency: "ZAR",
          externalProvider: "PAYFAST",
          externalReference: pfPaymentId,
          idempotencyKey: `${checkout.engagementId}:SEEKER_PAYMENT`,
          initiatedAt: checkout.createdAt,
          completedAt,
        },
        update: {
          mode: "PAYFAST_SANDBOX",
          status: "COMPLETED",
          amount: checkout.amount,
          externalProvider: "PAYFAST",
          externalReference: pfPaymentId,
          completedAt,
          failedAt: null,
          failureReason: null,
        },
      });

      if (checkout.saveCard && body.token) {
        const token = body.token;
        const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
        const encrypted = this.encryptToken(token);
        const existing = await tx.savedPaymentMethod.findUnique({ where: { tokenHash } });
        if (existing && existing.userId !== checkout.userId) {
          throw new ConflictException("PayFast returned a payment token already linked to another AnySkill account.");
        }
        if (existing) {
          await tx.savedPaymentMethod.update({
            where: { id: existing.id },
            data: { ...encrypted, status: "ACTIVE", cardBrand: body.card_type ?? existing.cardBrand, lastFour: body.card_last_four ?? existing.lastFour },
          });
        } else {
          const hasDefault = await tx.savedPaymentMethod.count({ where: { userId: checkout.userId, status: "ACTIVE", isDefault: true } });
          await tx.savedPaymentMethod.create({
            data: {
              userId: checkout.userId,
              tokenHash,
              ...encrypted,
              cardBrand: body.card_type ?? null,
              lastFour: body.card_last_four && /^\d{4}$/.test(body.card_last_four) ? body.card_last_four : null,
              isDefault: hasDefault === 0,
              consentAt: completedAt,
            },
          });
        }
      }
      await tx.appNotification.create({
        data: {
          userId: checkout.engagement.providerId!,
          title: "Seeker payment confirmed",
          body: "PayFast confirmed payment for your completed AnySkill job. Provider payout is pending settlement and is not yet marked as transferred.",
          data: { type: "PAYFAST_PAYMENT_CONFIRMED", requestId: checkout.engagement.requestId },
        },
      });
    });
    return { success: true, paymentStatus: "PAYFAST_PAID", providerPayoutStatus: "PENDING" };
  }
}

function cryptoRandomId(): string {
  return randomBytes(16).toString("hex");
}
