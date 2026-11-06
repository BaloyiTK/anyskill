import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import {
  CreateServiceRequestDto,
  ProviderResponseDto,
  RegisterPushDeviceDto,
  UpdateProviderProfileDto,
} from "./dto/service-request.dto";

type RankedProvider = { userId: string; score: number };
const normalise = (value: string) => value.trim().toLocaleLowerCase("en-ZA");
const RESPONSE_WINDOW_MS = Math.max(60, Number(process.env.MATCH_RESPONSE_WINDOW_SECONDS ?? 300)) * 1000;
const WAVE_SIZE = Math.max(1, Math.min(25, Number(process.env.MATCH_WAVE_SIZE ?? 5)));

@Injectable()
export class MarketplaceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketplaceService.name);
  private worker: ReturnType<typeof setInterval> | undefined;
  private workerRunning = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Matching deadlines and notification retries are persisted in PostgreSQL.
    // This lightweight poller is a development/single-instance worker; production
    // should run the same methods in a dedicated queue worker.
    this.worker = setInterval(() => { void this.runWorkerCycle(); }, 15_000);
    this.worker.unref?.();
  }

  onModuleDestroy() {
    if (this.worker) clearInterval(this.worker);
  }

  async createRequest(seekerId: string, input: CreateServiceRequestDto) {
    const seeker = await this.prisma.user.findUnique({
      where: { id: seekerId },
      select: { identityVerification: true },
    });
    if (!seeker || seeker.identityVerification !== "VERIFIED") {
      throw new ForbiddenException({
        code: "IDENTITY_VERIFICATION_REQUIRED",
        action: "SEEKER_SUBMIT_REQUEST",
        message: "Complete identity verification before submitting your service request.",
      });
    }

    const request = await this.prisma.serviceRequest.create({
      data: {
        seekerId,
        title: input.title.trim(),
        skillCategory: input.skillCategory.trim(),
        description: input.description.trim(),
        imageUrls: input.imageUrls ?? [],
        location: input.location?.trim() || null,
        deliveryMode: input.deliveryMode,
        preferredStartAt: input.preferredStartAt ? new Date(input.preferredStartAt) : null,
        instructions: input.instructions?.trim() || null,
      },
      select: {
        id: true, title: true, skillCategory: true, description: true,
        imageUrls: true, location: true, deliveryMode: true,
        preferredStartAt: true, instructions: true, status: true, createdAt: true,
      },
    });

    const matching = await this.dispatchNextWave(request.id, 1);
    return { ...request, matching };
  }

  async updateProviderProfile(userId: string, input: UpdateProviderProfileDto) {
    const skillCategories = [...new Set(input.skillCategories.map(normalise).filter(Boolean))];
    const serviceAreas = [...new Set(input.serviceAreas.map(normalise).filter(Boolean))];
    const deliveryModes = [...new Set(input.deliveryModes)];
    if (skillCategories.length === 0) {
      throw new ConflictException("Add at least one skill category before becoming available.");
    }
    if (deliveryModes.length === 0) {
      throw new ConflictException("Choose at least one delivery mode.");
    }
    if (deliveryModes.includes("ONSITE") && serviceAreas.length === 0) {
      throw new ConflictException("Add at least one service area for on-site work.");
    }
    return this.prisma.providerProfile.upsert({
      where: { userId },
      create: { userId, skillCategories, serviceAreas, deliveryModes, isAvailable: input.isAvailable },
      update: { skillCategories, serviceAreas, deliveryModes, isAvailable: input.isAvailable },
      select: { skillCategories: true, serviceAreas: true, deliveryModes: true, isAvailable: true, updatedAt: true },
    });
  }

  async getProviderProfile(userId: string) {
    return this.prisma.providerProfile.findUnique({
      where: { userId },
      select: { skillCategories: true, serviceAreas: true, deliveryModes: true, isAvailable: true, updatedAt: true },
    });
  }

  async registerPushDevice(userId: string, input: RegisterPushDeviceDto) {
    if (!/^(Expo|Exponent)PushToken\[[^\]]+\]$/.test(input.expoPushToken)) {
      throw new ConflictException("The device did not provide a valid Expo push token.");
    }
    return this.prisma.pushDevice.upsert({
      where: { expoPushToken: input.expoPushToken },
      create: { userId, expoPushToken: input.expoPushToken, platform: input.platform },
      update: { userId, platform: input.platform, lastSeenAt: new Date() },
      select: { id: true, platform: true, lastSeenAt: true },
    });
  }

  async listNotifications(userId: string) {
    return this.prisma.appNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true, body: true, data: true, readAt: true, createdAt: true },
    });
  }

  async markNotificationRead(userId: string, notificationId: string) {
    const result = await this.prisma.appNotification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException("Notification not found.");
    return { success: true };
  }

  async listIncomingRequests(providerId: string, cursor?: string) {
    const requests = await this.prisma.serviceRequest.findMany({
      where: {
        status: "OPEN",
        matches: { some: { providerId, status: { in: ["NOTIFIED", "RESPONDED"] } } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true, title: true, skillCategory: true, description: true,
        imageUrls: true, location: true, deliveryMode: true,
        preferredStartAt: true, instructions: true, status: true, createdAt: true,
        providerResponses: {
          where: { providerId },
          select: { id: true, status: true, createdAt: true },
        },
      },
    });
    const hasMore = requests.length > 20;
    const items = requests.slice(0, 20).map(({ providerResponses, ...request }) => ({
      ...request,
      alreadyResponded: providerResponses.length > 0,
      myResponse: providerResponses[0] ?? null,
    }));
    return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
  }

  async listMyRequests(seekerId: string) {
    return this.prisma.serviceRequest.findMany({
      where: { seekerId },
      orderBy: { createdAt: "desc" },
      include: {
        providerResponses: {
          orderBy: { createdAt: "asc" },
          select: { id: true, providerId: true, status: true, message: true, createdAt: true },
        },
      },
    });
  }

  async respondToRequest(providerId: string, requestId: string, input: ProviderResponseDto) {
    const provider = await this.prisma.user.findUnique({
      where: { id: providerId },
      select: { identityVerification: true },
    });
    if (!provider || provider.identityVerification !== "VERIFIED") {
      throw new ForbiddenException({
        code: "IDENTITY_VERIFICATION_REQUIRED",
        action: "PROVIDER_ACCEPT_REQUEST",
        message: "You can view this request, but you must complete identity verification before accepting it. Your request will remain available if it has not been taken or closed.",
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const request = await tx.serviceRequest.findUnique({
          where: { id: requestId },
          select: { id: true, seekerId: true, status: true },
        });
        if (!request) throw new NotFoundException("This service request could not be found.");
        if (request.seekerId === providerId) throw new ForbiddenException("You cannot respond to your own service request.");
        if (request.status !== "OPEN") throw new ConflictException("This service request is no longer available.");

        const match = await tx.requestMatch.findUnique({
          where: { requestId_providerId: { requestId, providerId } },
          select: { id: true },
        });
        if (!match) throw new ForbiddenException("This request has not been matched to your Provider profile.");

        const response = await tx.providerResponse.create({
          data: { requestId, providerId, message: input.message?.trim() || null, status: "OFFERED" },
          select: { id: true, requestId: true, status: true, message: true, createdAt: true },
        });
        await tx.requestMatch.update({ where: { id: match.id }, data: { status: "RESPONDED" } });
        await tx.serviceRequest.update({ where: { id: requestId }, data: { matchingNextAt: null } });
        await tx.appNotification.create({
          data: {
            userId: request.seekerId,
            title: "A Provider has responded",
            body: "A matched Skill Provider has sent you an offer. Review the response in AnySkill.",
            data: { type: "PROVIDER_RESPONSE", requestId, responseId: response.id },
          },
        });
        return response;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("You have already responded to this request.");
      }
      throw error;
    }
  }

  private async runWorkerCycle() {
    if (this.workerRunning) return;
    this.workerRunning = true;
    try {
      await this.expandExpiredWaves();
      await this.dispatchPendingNotifications();
    } catch (error) {
      this.logger.error("Marketplace worker cycle failed.", error);
    } finally {
      this.workerRunning = false;
    }
  }

  private async rankedProviders(request: {
    id: string; seekerId: string; skillCategory: string; location: string | null; deliveryMode: string;
  }): Promise<RankedProvider[]> {
    const profiles = await this.prisma.providerProfile.findMany({
      where: { isAvailable: true, skillCategories: { has: normalise(request.skillCategory) }, userId: { not: request.seekerId } },
      select: { userId: true, serviceAreas: true, deliveryModes: true, updatedAt: true },
    });
    const area = request.location ? normalise(request.location) : null;
    return profiles.flatMap((profile) => {
      const modes = profile.deliveryModes;
      const modeMatches = modes.includes("EITHER") || modes.includes(request.deliveryMode) ||
        (request.deliveryMode === "EITHER" && (modes.includes("ONSITE") || modes.includes("REMOTE")));
      if (!modeMatches) return [];
      const areaMatches = !area || request.deliveryMode === "REMOTE" ||
        profile.serviceAreas.some((serviceArea) => area.includes(serviceArea) || serviceArea.includes(area));
      if (!areaMatches) return [];
      const score = 100 + (area && profile.serviceAreas.length ? 40 : 0) + (modes.includes(request.deliveryMode) ? 20 : 10);
      return [{ userId: profile.userId, score }];
    }).sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  }

  private async dispatchNextWave(requestId: string, wave: number) {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: { id: true, seekerId: true, skillCategory: true, location: true, deliveryMode: true, status: true },
    });
    if (!request || request.status !== "OPEN") return { notified: 0, wave };

    const ranked = await this.rankedProviders(request);
    const alreadyMatched = await this.prisma.requestMatch.findMany({
      where: { requestId },
      select: { providerId: true },
    });
    const seen = new Set(alreadyMatched.map((match) => match.providerId));
    const next = ranked.filter((provider) => !seen.has(provider.userId)).slice(0, WAVE_SIZE);
    if (next.length === 0) {
      await this.prisma.serviceRequest.update({
        where: { id: requestId },
        data: { matchingNextAt: null, matchingExhaustedAt: new Date() },
      });
      return { notified: 0, wave, exhausted: true };
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.requestMatch.createMany({
        data: next.map((provider) => ({
          requestId, providerId: provider.userId, score: provider.score, wave, status: "NOTIFIED" as const,
        })),
        skipDuplicates: true,
      }),
      this.prisma.appNotification.createMany({
        data: next.map((provider) => ({
          userId: provider.userId,
          title: "New work request matched to you",
          body: "A Skill Seeker has posted a request that matches your skills and availability.",
          data: { type: "MATCHED_REQUEST", requestId, wave },
        })),
      }),
      this.prisma.serviceRequest.update({
        where: { id: requestId },
        data: {
          matchingWave: wave,
          matchingNextAt: new Date(now.getTime() + RESPONSE_WINDOW_MS),
          matchingExhaustedAt: null,
        },
      }),
    ]);
    return { notified: next.length, wave, responseWindowSeconds: RESPONSE_WINDOW_MS / 1000 };
  }

  private async expandExpiredWaves() {
    const now = new Date();
    const due = await this.prisma.serviceRequest.findMany({
      where: { status: "OPEN", matchingNextAt: { lte: now }, matchingExhaustedAt: null },
      select: { id: true, matchingWave: true },
      take: 20,
      orderBy: { matchingNextAt: "asc" },
    });
    for (const request of due) {
      const claim = await this.prisma.serviceRequest.updateMany({
        where: { id: request.id, matchingNextAt: { lte: now }, status: "OPEN" },
        data: { matchingNextAt: new Date(now.getTime() + 60_000) },
      });
      if (claim.count === 0) continue;
      const responses = await this.prisma.providerResponse.count({
        where: { requestId: request.id, status: "OFFERED" },
      });
      if (responses > 0) {
        await this.prisma.serviceRequest.update({ where: { id: request.id }, data: { matchingNextAt: null } });
      } else {
        await this.dispatchNextWave(request.id, request.matchingWave + 1);
      }
    }
  }

  private async dispatchPendingNotifications() {
    const pending = await this.prisma.appNotification.findMany({
      where: { deliveryStatus: "PENDING", attempts: { lt: 5 } },
      take: 50,
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true, title: true, body: true, data: true, attempts: true },
    });
    for (const notification of pending) {
      const devices = await this.prisma.pushDevice.findMany({
        where: { userId: notification.userId },
        select: { expoPushToken: true },
      });
      if (devices.length === 0) {
        await this.prisma.appNotification.updateMany({
          where: { id: notification.id, deliveryStatus: "PENDING" },
          data: { deliveryStatus: "IN_APP_ONLY" },
        });
        continue;
      }
      const claim = await this.prisma.appNotification.updateMany({
        where: { id: notification.id, deliveryStatus: "PENDING" },
        data: { deliveryStatus: "SENDING", attempts: { increment: 1 } },
      });
      if (claim.count === 0) continue;
      try {
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(devices.map((device) => ({
            to: device.expoPushToken,
            title: notification.title,
            body: notification.body,
            data: notification.data ?? {},
            sound: "default",
            priority: "high",
          }))),
        });
        if (!response.ok) throw new Error(`Expo Push Service returned HTTP ${response.status}`);
        const payload = await response.json() as { data?: Array<{ status?: string; message?: string }> };
        const tickets = payload.data ?? [];
        if (tickets.length === 0 || tickets.some((ticket) => ticket.status !== "ok")) {
          throw new Error(tickets.find((ticket) => ticket.status !== "ok")?.message ?? "No push delivery tickets returned.");
        }
        await this.prisma.appNotification.update({
          where: { id: notification.id },
          data: { deliveryStatus: "SENT", sentAt: new Date() },
        });
      } catch (error) {
        const attempts = notification.attempts + 1;
        await this.prisma.appNotification.update({
          where: { id: notification.id },
          data: { deliveryStatus: attempts >= 5 ? "FAILED" : "PENDING" },
        });
        this.logger.warn(`Push notification ${notification.id} failed: ${String(error)}`);
      }
    }
  }
}
