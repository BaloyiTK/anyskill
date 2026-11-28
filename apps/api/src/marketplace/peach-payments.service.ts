import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

type PeachResponse = Record<string, any>;

@Injectable()
export class PeachPaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  private config() {
    const mode = (process.env.PEACH_ENV ?? "sandbox").trim().toLowerCase();
    if (mode !== "sandbox") {
      throw new ServiceUnavailableException("Peach Payments is currently enabled for sandbox testing only.");
    }
    const profileId = process.env.PEACH_PROFILE_ID?.trim();
    const apiKey = process.env.PEACH_API_KEY?.trim();
    const publishableKey = process.env.PEACH_PUBLISHABLE_KEY?.trim();
    const baseUrl = (process.env.PEACH_API_URL ?? "https://app.sandbox-next.peachpayments.com/api").trim().replace(/\/$/, "");
    if (!profileId || !apiKey || !publishableKey) {
      throw new ServiceUnavailableException("Peach Payments sandbox is not configured. Add PEACH_PROFILE_ID, PEACH_PUBLISHABLE_KEY and PEACH_API_KEY to the API environment.");
    }
    if (!/^https:\/\//i.test(baseUrl)) {
      throw new ServiceUnavailableException("PEACH_API_URL must use HTTPS.");
    }
    if (!profileId.startsWith("pro_") || !publishableKey.startsWith("pk_snd_") || !apiKey.startsWith("snd_")) {
      throw new ServiceUnavailableException("Peach sandbox credentials have an unexpected format. Check the profile ID and sandbox API keys.");
    }
    return { profileId, apiKey, publishableKey, baseUrl };
  }

  private async request(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<PeachResponse> {
    const config = this.config();
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}${path}`, {
        method,
        headers: {
          "api-key": config.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new BadGatewayException("Could not connect to Peach Payments. Please try again.");
    }
    const payload = await response.json().catch(() => ({})) as PeachResponse;
    if (!response.ok) {
      // Do not pass provider payloads through: they may contain sensitive diagnostics.
      throw new BadGatewayException(
        typeof payload.message === "string" ? `Peach Payments rejected the request: ${payload.message.slice(0, 180)}` : "Peach Payments could not process the request.",
      );
    }
    return payload;
  }

  async createCardSetup(userId: string) {
    const config = this.config();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true, peachCustomerId: true },
    });
    if (!user) throw new NotFoundException("Account not found.");

    let customerId = user.peachCustomerId;
    if (!customerId) {
      const customer = await this.request("/customers", "POST", {
        profile_id: config.profileId,
        email: user.email,
        name: user.email,
        ...(user.phone ? { phone: user.phone } : {}),
      });
      customerId = String(customer.customer_id ?? customer.id ?? "");
      if (!customerId.startsWith("cus_")) {
        throw new BadGatewayException("Peach Payments did not return a valid customer reference.");
      }
      await this.prisma.user.update({ where: { id: userId }, data: { peachCustomerId: customerId } });
    }

    const [ephemeral, setup] = await Promise.all([
      this.request("/ephemeral_keys", "POST", { profile_id: config.profileId, customer_id: customerId }),
      this.request("/setup_intents", "POST", {
        profile_id: config.profileId,
        customer: { id: customerId },
        usage: "off_session",
      }),
    ]);
    const setupIntentId = String(setup.id ?? setup.setup_intent_id ?? "");
    const clientSecret = String(setup.client_secret ?? setup.clientSecret ?? "");
    const ephemeralKeySecret = String(ephemeral.secret ?? ephemeral.ephemeral_key_secret ?? "");
    if (!setupIntentId.startsWith("seti_") || !clientSecret || !ephemeralKeySecret) {
      throw new BadGatewayException("Peach Payments returned incomplete card-registration details.");
    }

    await this.prisma.peachCardSetup.create({
      data: {
        userId,
        setupIntentId,
        consentAt: new Date(),
        status: "PENDING",
      },
    });

    return {
      setupIntentId,
      clientSecret,
      customerId,
      ephemeralKeySecret,
      publishableKey: config.publishableKey,
      merchantDisplayName: "AnySkill",
    };
  }

  async listSavedPaymentMethods(userId: string) {
    return this.prisma.peachSavedPaymentMethod.findMany({
      where: { userId, status: "ACTIVE" },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      select: { id: true, cardBrand: true, lastFour: true, status: true, isDefault: true, createdAt: true },
    }).then((items) => items.map((item) => ({ ...item, provider: "PEACH" })));
  }

  async setDefaultSavedPaymentMethod(userId: string, paymentMethodId: string) {
    const method = await this.prisma.peachSavedPaymentMethod.findFirst({ where: { id: paymentMethodId, userId, status: "ACTIVE" } });
    if (!method) return false;
    await this.prisma.$transaction([
      this.prisma.peachSavedPaymentMethod.updateMany({ where: { userId }, data: { isDefault: false } }),
      this.prisma.peachSavedPaymentMethod.update({ where: { id: method.id }, data: { isDefault: true } }),
    ]);
    return true;
  }

  async removeSavedPaymentMethod(userId: string, paymentMethodId: string) {
    const method = await this.prisma.peachSavedPaymentMethod.findFirst({ where: { id: paymentMethodId, userId } });
    if (!method) return false;
    await this.prisma.peachSavedPaymentMethod.update({ where: { id: method.id }, data: { status: "REMOVED", isDefault: false } });
    if (method.isDefault) {
      const next = await this.prisma.peachSavedPaymentMethod.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
      if (next) await this.prisma.peachSavedPaymentMethod.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return true;
  }

  async getCardSetupStatus(userId: string, setupIntentId: string) {
    const record = await this.prisma.peachCardSetup.findFirst({
      where: { userId, setupIntentId },
    });
    if (!record) throw new NotFoundException("Card registration was not found.");

    const remote = await this.request(`/setup_intents/${encodeURIComponent(setupIntentId)}`, "GET");
    const remoteStatus = String(remote.status ?? "").toLowerCase();
    const complete = remoteStatus === "succeeded";
    const failed = ["failed", "cancelled", "canceled"].includes(remoteStatus);
    const status = complete ? "COMPLETE" : failed ? "FAILED" : "PENDING";
    if (record.status !== status) {
      await this.prisma.peachCardSetup.update({
        where: { id: record.id },
        data: {
          status,
          ...(complete ? { completedAt: new Date() } : {}),
          ...(failed ? { failedAt: new Date(), failureReason: "Peach Setup Intent did not succeed." } : {}),
        },
      });
    }
    if (complete) {
      const paymentMethodId = String(remote.payment_method_id ?? remote.payment_method?.id ?? "");
      if (paymentMethodId.startsWith("pm_")) {
        const card = remote.payment_method?.card ?? remote.payment_method_data?.card ?? {};
        await this.prisma.peachSavedPaymentMethod.upsert({
          where: { peachPaymentMethodId: paymentMethodId },
          create: {
            userId,
            peachPaymentMethodId: paymentMethodId,
            cardBrand: typeof card.brand === "string" ? card.brand : null,
            lastFour: typeof card.last4 === "string" ? card.last4 : null,
            consentAt: record.consentAt,
            isDefault: !(await this.prisma.peachSavedPaymentMethod.count({ where: { userId, status: "ACTIVE" } })),
          },
          update: { status: "ACTIVE" },
        });
      }
    }
    return { setupIntentId, status };
  }
}
