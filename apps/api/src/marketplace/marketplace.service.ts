import {
  BadRequestException,
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
import { LiveProviderMapService } from "./live-provider-map.service";
import {
  CreateServiceRequestDto,
  ProviderResponseDto,
  RegisterPushDeviceDto,
  UpdateProviderProfileDto,
  SubmitEstimateDto, DecideEstimateDto, RequestAdditionalHoursDto, DecideAdditionalHoursDto, SubmitJobCompletionDto, DecideJobCompletionDto,
  UpdateHomeLocationDto, UpdateLiveLocationDto, ScheduleServiceRequestDto,
} from "./dto/service-request.dto";

type RankedProvider = { userId: string; score: number };
const normalise = (value: string) => value.trim().toLocaleLowerCase("en-ZA");
const RESPONSE_WINDOW_MS = Math.max(60, Number(process.env.MATCH_RESPONSE_WINDOW_SECONDS ?? 300)) * 1000;
const WAVE_SIZE = Math.max(1, Math.min(25, Number(process.env.MATCH_WAVE_SIZE ?? 5)));
const LIVE_MATCHING_WINDOW_MS = 30 * 60 * 1000;
const LIVE_LOCATION_MAX_AGE_MS = 30_000;
const MAX_LIVE_LOCATION_ACCURACY_M = 50;

@Injectable()
export class MarketplaceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketplaceService.name);
  private worker: ReturnType<typeof setInterval> | undefined;
  private workerRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly liveProviderMap: LiveProviderMapService,
  ) {}

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

  async listSkills(query: string) {
    const profiles = await this.prisma.providerProfile.findMany({
      where: { skillCategories: { isEmpty: false }, user: { is: { providerRoleStatus: "ACTIVE", identityVerification: "VERIFIED" } } }, select: { skillCategories: true }, take: 2000,
    });
    const counts = new Map<string, number>();
    for (const profile of profiles) for (const skill of profile.skillCategories) {
      const canonical = skill.trim().replace(/\s+/g, " ");
      if (!canonical) continue;
      const key = normalise(canonical);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const needle = normalise(query).replace(/[^\p{L}\p{N}]+/gu, "");
    const ranked = [...counts.entries()].map(([key, count]) => {
      const compact = key.replace(/[^\p{L}\p{N}]+/gu, "");
      const score = !needle ? 0 : compact === needle ? 100 : compact.startsWith(needle) || needle.startsWith(compact) ? 70 : compact.includes(needle) || needle.includes(compact) ? 50 : 0;
      return { name: key.replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-ZA")), providerCount: count, score };
    }).filter((skill) => !needle || skill.score > 0)
      .sort((a, b) => b.score - a.score || b.providerCount - a.providerCount || a.name.localeCompare(b.name))
      .slice(0, 12);
    return { items: ranked.map(({ name, providerCount }) => ({ name, providerCount })) };
  }

  async createRequest(seekerId: string, input: CreateServiceRequestDto) {
    if ((input.latitude == null) !== (input.longitude == null)) throw new BadRequestException("Provide both latitude and longitude for the job location.");
    if (input.deliveryMode !== "REMOTE" && (input.latitude == null || input.longitude == null)) throw new BadRequestException("Choose the job location on the map before publishing an on-site or either-mode request.");
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
        // Remote-only requests must never retain a physical location, even if a
        // client accidentally includes stale coordinates in its payload.
        latitude: input.deliveryMode === "REMOTE" ? null : input.latitude ?? null,
        longitude: input.deliveryMode === "REMOTE" ? null : input.longitude ?? null,
        deliveryMode: input.deliveryMode,
        preferredStartAt: input.preferredStartAt ? new Date(input.preferredStartAt) : null,
        instructions: input.instructions?.trim() || null,
      },
      select: {
        id: true, title: true, skillCategory: true, description: true,
        imageUrls: true, location: true, deliveryMode: true, matchingStartedAt: true,
        preferredStartAt: true, instructions: true, status: true, createdAt: true,
      },
    });

    const matching = await this.dispatchNextWave(request.id, 1);
    return { ...request, matching };
  }


  async getHomeLocation(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId }, select: { homeLocationLabel: true, homeLatitude: true, homeLongitude: true } });
  }

  async updateHomeLocation(userId: string, input: UpdateHomeLocationDto) {
    return this.prisma.user.update({ where: { id: userId }, data: { homeLocationLabel: input.label.trim(), homeLatitude: input.latitude, homeLongitude: input.longitude }, select: { homeLocationLabel: true, homeLatitude: true, homeLongitude: true } });
  }

  async updateProviderLiveLocation(userId: string, input: UpdateLiveLocationDto) {
    if (input.accuracyM > MAX_LIVE_LOCATION_ACCURACY_M) throw new ConflictException("GPS accuracy is too low. Wait for a more accurate location fix (50 m or better).");
    const updatedAt = new Date();
    // Any online Provider shares a live map location, regardless of skill or
    // delivery mode. Going offline clears the location and stops this heartbeat.
    const result = await this.prisma.providerProfile.updateMany({
      where: { userId, isAvailable: true },
      data: {
        liveLatitude: input.latitude,
        liveLongitude: input.longitude,
        liveAccuracyM: input.accuracyM,
        liveLocationUpdatedAt: updatedAt,
      },
    });
    if (result.count !== 1) {
      const profile = await this.prisma.providerProfile.findUnique({ where: { userId }, select: { userId: true } });
      if (!profile) throw new NotFoundException("Create your Provider profile before sharing live location.");
      throw new ConflictException("Set your Provider status to Available before sharing your live location.");
    }
    this.liveProviderMap.notifyChanged();
    return { isAvailable: true, liveLocationUpdatedAt: updatedAt, liveAccuracyM: input.accuracyM };
  }

  async updateProviderProfile(userId: string, input: UpdateProviderProfileDto) {
    if (input.isAvailable) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { providerRoleStatus: true, identityVerification: true },
      });
      if (!user || user.providerRoleStatus !== "ACTIVE") {
        throw new ForbiddenException({
          code: "PROVIDER_APPROVAL_REQUIRED",
          message: "Provider availability is only available after your Provider application is approved.",
        });
      }
      if (user.identityVerification !== "VERIFIED") {
        throw new ForbiddenException({
          code: "IDENTITY_VERIFICATION_REQUIRED",
          action: "PROVIDER_GO_ONLINE",
          message: "Complete identity verification before going online.",
        });
      }
    }
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
    if (input.isAvailable && (
      input.latitude == null ||
      input.longitude == null ||
      input.accuracyM == null ||
      input.accuracyM > MAX_LIVE_LOCATION_ACCURACY_M
    )) {
      throw new ConflictException("A fresh GPS fix with accuracy of 50 m or better is required before going online.");
    }
    const onlineAt = input.isAvailable ? new Date() : null;
    const liveLocationData = input.isAvailable
      ? {
          liveLatitude: input.latitude!,
          liveLongitude: input.longitude!,
          liveAccuracyM: input.accuracyM!,
          liveLocationUpdatedAt: onlineAt!,
        }
      : { liveLatitude: null, liveLongitude: null, liveAccuracyM: null, liveLocationUpdatedAt: null };
    const updated = await this.prisma.providerProfile.upsert({
      where: { userId },
      create: {
        userId,
        publicName: input.publicName.trim(),
        hourlyRate: input.hourlyRate,
        assessmentFee: input.assessmentFee,
        skillCategories,
        serviceAreas,
        deliveryModes,
        isAvailable: input.isAvailable,
        ...liveLocationData,
      },
      update: {
        publicName: input.publicName.trim(),
        hourlyRate: input.hourlyRate,
        assessmentFee: input.assessmentFee,
        skillCategories,
        serviceAreas,
        deliveryModes,
        isAvailable: input.isAvailable,
        ...liveLocationData,
      },
      select: { publicName: true, hourlyRate: true, assessmentFee: true, skillCategories: true, serviceAreas: true, deliveryModes: true, isAvailable: true, liveLatitude: true, liveLongitude: true, liveAccuracyM: true, liveLocationUpdatedAt: true, updatedAt: true },
    });
    this.liveProviderMap.notifyChanged();
    return updated;
  }

  async getProviderProfile(userId: string) {
    return this.prisma.providerProfile.findUnique({
      where: { userId },
      select: { publicName: true, hourlyRate: true, assessmentFee: true, skillCategories: true, serviceAreas: true, deliveryModes: true, isAvailable: true, updatedAt: true },
    });
  }

  async discoverNearbyProviders(latitude: number, longitude: number, seekerRadiusKm: number) {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        ![5, 10, 20, 50].includes(seekerRadiusKm)) {
      throw new BadRequestException("Provide valid coordinates and a supported map radius (5, 10, 20 or 50 km).");
    }

    // Discovery is independent of service-request matching. Show online
    // Providers within the Seeker's selected map radius. Do not filter by skill,
    // identity status, Provider role status, or delivery mode.
    // A map pin is live only while the provider has refreshed it recently.
    const cutoff = new Date(Date.now() - LIVE_LOCATION_MAX_AGE_MS);
    const profiles = await this.prisma.providerProfile.findMany({
      where: {
        isAvailable: true,
        liveLatitude: { not: null },
        liveLongitude: { not: null },
        liveLocationUpdatedAt: { gte: cutoff },
      },
      select: {
        id: true,
        skillCategories: true,
        liveLatitude: true,
        liveLongitude: true,
      },
      orderBy: { liveLocationUpdatedAt: "desc" },
    });

    const radians = (degrees: number) => degrees * Math.PI / 180;
    const distanceKm = (lat: number, lon: number) => {
      const dLat = radians(lat - latitude);
      const dLon = radians(lon - longitude);
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(radians(latitude)) * Math.cos(radians(lat)) * Math.sin(dLon / 2) ** 2;
      return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    return profiles.flatMap((profile) => {
      if (profile.liveLatitude == null || profile.liveLongitude == null) return [];
      const distance = distanceKm(profile.liveLatitude, profile.liveLongitude);
      if (distance > seekerRadiusKm) return [];
      return [{
        id: profile.id,
        skill: profile.skillCategories[0] || "Skill not added",
        distanceKm: Math.round(distance * 10) / 10,
        // Approximately 100 m precision is sufficient for a public discovery pin.
        latitude: Math.round(profile.liveLatitude * 1000) / 1000,
        longitude: Math.round(profile.liveLongitude * 1000) / 1000,
      }];
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
    const [requests, providerProfile] = await Promise.all([
      this.prisma.serviceRequest.findMany({
        where: {
          status: "OPEN",
          matches: { some: { providerId, status: { in: ["NOTIFIED", "RESPONDED"] } } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 21,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true, title: true, skillCategory: true, description: true,
          imageUrls: true, location: true, latitude: true, longitude: true,
          deliveryMode: true, preferredStartAt: true, instructions: true,
          status: true, createdAt: true,
          seeker: {
            select: {
              identityVerification: true,
              onboardingDraft: { select: { profile: true } },
            },
          },
          providerResponses: {
            where: { providerId },
            select: { id: true, status: true, createdAt: true },
          },
        },
      }),
      this.prisma.providerProfile.findUnique({
        where: { userId: providerId },
        select: { liveLatitude: true, liveLongitude: true, liveLocationUpdatedAt: true },
      }),
    ]);
    const hasMore = requests.length > 20;
    const now = Date.now();
    const hasFreshProviderLocation = providerProfile?.liveLatitude != null
      && providerProfile.liveLongitude != null
      && providerProfile.liveLocationUpdatedAt != null
      && now - providerProfile.liveLocationUpdatedAt.getTime() <= LIVE_LOCATION_MAX_AGE_MS;
    const providerLocation = hasFreshProviderLocation
      ? { latitude: providerProfile!.liveLatitude!, longitude: providerProfile!.liveLongitude! }
      : null;
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const distanceBetween = (latitude: number, longitude: number, targetLatitude: number, targetLongitude: number) => {
      const dLat = radians(targetLatitude - latitude);
      const dLon = radians(targetLongitude - longitude);
      const a = Math.sin(dLat / 2) ** 2
        + Math.cos(radians(latitude)) * Math.cos(radians(targetLatitude)) * Math.sin(dLon / 2) ** 2;
      return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    const items = requests.slice(0, 20).map(({ providerResponses, seeker, ...request }) => {
      const profile = seeker?.onboardingDraft?.profile;
      const seekerProfile = profile && typeof profile === "object" && !Array.isArray(profile)
        ? profile as Record<string, unknown>
        : {};
      const firstName = typeof seekerProfile.firstName === "string" ? seekerProfile.firstName.trim() : "";
      const lastName = typeof seekerProfile.lastName === "string" ? seekerProfile.lastName.trim() : "";
      const photo = typeof seekerProfile.profilePhotoUrl === "string" ? seekerProfile.profilePhotoUrl.trim() : "";
      const distanceKm = providerLocation && request.latitude != null && request.longitude != null
        ? Math.round(distanceBetween(providerLocation.latitude, providerLocation.longitude, request.latitude, request.longitude) * 10) / 10
        : null;
      return {
        ...request,
        seeker: {
          firstName,
          lastName,
          profilePhotoUrl: photo || null,
          identityVerified: seeker?.identityVerification === "VERIFIED",
        },
        providerLocation,
        distanceKm,
        alreadyResponded: providerResponses.length > 0,
        myResponse: providerResponses[0] ?? null,
      };
    });
    return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
  }

  async listMyRequests(seekerId: string) {
    const requests = await this.prisma.serviceRequest.findMany({
      where: { seekerId },
      orderBy: { createdAt: "desc" },
      include: {
        jobEngagement: { include: { adjustments: { orderBy: { createdAt: "desc" } }, completionSubmissions: { include: { evidenceAssets: { select: { id: true, contentType: true, originalName: true, sizeBytes: true } } }, orderBy: { submittedAt: "desc" } } } },
        _count: { select: { matches: true } },
        providerResponses: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true, providerId: true, status: true, message: true, createdAt: true,
            hourlyRateAtOffer: true, assessmentFeeAtOffer: true,
            provider: {
              select: {
                providerProfile: {
                  select: { publicName: true, hourlyRate: true, assessmentFee: true, skillCategories: true, serviceAreas: true, deliveryModes: true },
                },
              },
            },
          },
        },
      },
    });
    const serverNow = new Date().toISOString();
    return requests.map((request) => ({
      ...request,
      jobEngagement: request.jobEngagement ? { ...request.jobEngagement, serverNow } : null,
    }));
  }

  async cancelRequest(seekerId: string, requestId: string) {
    const request = await this.prisma.serviceRequest.findFirst({
      where: { id: requestId, seekerId },
      select: { id: true, status: true },
    });
    if (!request) throw new NotFoundException("This service request could not be found.");
    if (request.status !== "OPEN") throw new ConflictException("Only an open request can be cancelled.");
    const changed = await this.prisma.serviceRequest.updateMany({
      where: { id: requestId, seekerId, status: "OPEN" },
      data: { status: "CANCELLED", matchingNextAt: null },
    });
    if (changed.count !== 1) throw new ConflictException("The request changed. Refresh and try again.");
    await this.prisma.requestMatch.updateMany({
      where: { requestId, status: "NOTIFIED" },
      data: { status: "EXPIRED" },
    });
    return { success: true, requestId, status: "CANCELLED" };
  }

  async scheduleRequest(seekerId: string, requestId: string, input: ScheduleServiceRequestDto) {
    const preferredStartAt = new Date(input.preferredStartAt);
    if (!Number.isFinite(preferredStartAt.getTime()) || preferredStartAt.getTime() < Date.now() + 15 * 60 * 1000) {
      throw new BadRequestException("Choose a scheduled start time at least 15 minutes from now.");
    }
    const request = await this.prisma.serviceRequest.findFirst({
      where: { id: requestId, seekerId, status: "OPEN" },
      select: { id: true, matchingWave: true, matchingStartedAt: true },
    });
    if (!request) throw new NotFoundException("This open service request could not be found.");
    if (Date.now() - request.matchingStartedAt.getTime() < LIVE_MATCHING_WINDOW_MS) throw new ConflictException("Live Provider search has not timed out yet. You can schedule this request after 30 minutes.");
    const restarted = await this.prisma.serviceRequest.updateMany({
      where: { id: requestId, seekerId, status: "OPEN", matchingStartedAt: request.matchingStartedAt },
      data: { preferredStartAt, matchingStartedAt: new Date(), matchingWave: 0, matchingNextAt: null, matchingExhaustedAt: null },
    });
    if (restarted.count !== 1) throw new ConflictException("The request changed. Refresh before scheduling it.");
    const matching = await this.dispatchNextWave(requestId, 1, true);
    return { success: true, requestId, preferredStartAt, matching };
  }

  async selectProvider(seekerId: string, requestId: string, responseId: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.serviceRequest.findUnique({
        where: { id: requestId },
        select: { id: true, seekerId: true, status: true, title: true },
      });
      if (!request) throw new NotFoundException("This service request could not be found.");
      if (request.seekerId !== seekerId) throw new ForbiddenException("Only the Skill Seeker who created this request can select a Provider.");
      if (request.status !== "OPEN") throw new ConflictException("This request is no longer open for Provider selection.");

      const offer = await tx.providerResponse.findFirst({
        where: { id: responseId, requestId, status: "OFFERED" },
        select: { id: true, providerId: true },
      });
      if (!offer || !offer.providerId) throw new NotFoundException("This Provider offer is no longer available.");

      // Conditional update is the final concurrency guard: only one selection can close an open request.
      const claimed = await tx.serviceRequest.updateMany({
        where: { id: requestId, seekerId, status: "OPEN" },
        data: { status: "CLOSED", matchingNextAt: null },
      });
      if (claimed.count !== 1) throw new ConflictException("Another selection or request update has already closed this request.");

      await tx.providerResponse.update({
        where: { id: offer.id },
        data: { status: "SELECTED" },
      });
      await tx.providerResponse.updateMany({
        where: { requestId, id: { not: offer.id }, status: "OFFERED" },
        data: { status: "WITHDRAWN" },
      });
      await tx.requestMatch.updateMany({
        where: { requestId, providerId: offer.providerId },
        data: { status: "RESPONDED" },
      });
      await tx.appNotification.create({
        data: {
          userId: offer.providerId,
          title: "Your offer was selected",
          body: `The Skill Seeker selected your offer for: ${request.title}`,
          data: { type: "PROVIDER_SELECTED", requestId, responseId: offer.id },
        },
      });
      await tx.jobEngagement.create({
        data: { requestId, responseId: offer.id, seekerId, providerId: offer.providerId, hourlyRate: (await tx.providerResponse.findUniqueOrThrow({ where: { id: offer.id }, select: { hourlyRateAtOffer: true } })).hourlyRateAtOffer!, assessmentFee: (await tx.providerResponse.findUniqueOrThrow({ where: { id: offer.id }, select: { assessmentFeeAtOffer: true } })).assessmentFeeAtOffer ?? 0 },
      });
      await tx.appNotification.create({ data: { userId: offer.providerId, title: "Assessment required", body: `Your offer was selected for: ${request.title}. Complete the assessment and submit an estimate before starting work.`, data: { type: "ASSESSMENT_REQUIRED", requestId } } });
      return { success: true, requestId, selectedResponseId: offer.id, selectedProviderId: offer.providerId, status: "ASSESSMENT_PENDING" };
    });
  }


  async listMyJobs(providerId: string) {
    const jobs = await this.prisma.jobEngagement.findMany({
      where: { providerId }, orderBy: { updatedAt: "desc" },
      include: { request: { select: { id: true, title: true, description: true, location: true, latitude: true, longitude: true } }, adjustments: { orderBy: { createdAt: "desc" } }, completionSubmissions: { include: { evidenceAssets: { select: { id: true, contentType: true, originalName: true, sizeBytes: true } } }, orderBy: { submittedAt: "desc" } } },
    });
    const serverNow = new Date().toISOString();
    return jobs.map((job) => ({ ...job, serverNow }));
  }


  async submitJobCompletion(providerId: string, requestId: string, input: SubmitJobCompletionDto) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (!job.providerId || job.providerId !== providerId) throw new ForbiddenException("Only the selected Provider can submit completion.");
      if (job.status !== "IN_PROGRESS") throw new ConflictException("The job must be in progress before completion can be submitted.");
      if (!job.workSegmentStartedAt || job.workPausedAt) throw new ConflictException("Resume the work timer before submitting completion.");
      const completionTime = new Date();
      const accumulatedWorkMs = job.workAccumulatedMs + Math.max(0, completionTime.getTime() - job.workSegmentStartedAt.getTime());
      const pendingAdjustments = await tx.jobCostAdjustment.count({ where: { engagementId: job.id, status: "PENDING" } });
      if (pendingAdjustments > 0) throw new ConflictException("Resolve pending additional-hours approvals before submitting completion.");
      const pendingSubmission = await tx.jobCompletionSubmission.count({ where: { engagementId: job.id, status: "PENDING" } });
      if (pendingSubmission > 0) throw new ConflictException("A completion submission is already awaiting the Seeker's review.");
      const evidenceIds = [...new Set(input.evidenceAssetIds)];
      if (evidenceIds.length !== input.evidenceAssetIds.length) throw new ConflictException("Duplicate evidence files are not allowed.");
      const assets = await tx.mediaAsset.findMany({
        where: { id: { in: evidenceIds }, userId: providerId, status: "READY", purpose: "JOB_COMPLETION_EVIDENCE", completionSubmissionId: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (assets.length !== evidenceIds.length) throw new ForbiddenException("One or more evidence files are unavailable, expired, or do not belong to you. Upload them again.");
      const submission = await tx.jobCompletionSubmission.create({
        data: {
          engagementId: job.id, providerId, notes: input.notes.trim(), evidenceUrls: [],
          evidenceAssets: { connect: evidenceIds.map((id) => ({ id })) },
        },
        include: { evidenceAssets: { select: { id: true, contentType: true, originalName: true, sizeBytes: true } } },
      });
      const claimed = await tx.jobEngagement.updateMany({
        where: { id: job.id, status: "IN_PROGRESS", workSegmentStartedAt: job.workSegmentStartedAt, workPausedAt: null },
        data: {
          status: "COMPLETION_PENDING",
          workAccumulatedMs: accumulatedWorkMs,
          workSegmentStartedAt: null,
          workPausedAt: null,
          workEndedAt: completionTime,
        },
      });
      if (claimed.count !== 1) throw new ConflictException("The job status changed. Refresh and try again.");
      if (job.seekerId) await tx.appNotification.create({
        data: { userId: job.seekerId, title: "Job completion submitted", body: "Your Provider submitted completion notes and photo evidence. Review the work in AnySkill.", data: { type: "JOB_COMPLETION_SUBMITTED", requestId, submissionId: submission.id } },
      });
      return submission;
    });
  }

  async decideJobCompletion(seekerId: string, requestId: string, submissionId: string, input: DecideJobCompletionDto) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (!job.seekerId || job.seekerId !== seekerId) throw new ForbiddenException("Only the Skill Seeker can review completion.");
      if (job.status !== "COMPLETION_PENDING") throw new ConflictException("There is no completion awaiting your review.");
      const submission = await tx.jobCompletionSubmission.findFirst({ where: { id: submissionId, engagementId: job.id, status: "PENDING" } });
      if (!submission) throw new NotFoundException("Pending completion submission not found.");
      if (!input.approved && !input.note?.trim()) throw new ConflictException("Please explain what needs to be corrected before rejecting completion.");
      const updatedSubmission = await tx.jobCompletionSubmission.update({
        where: { id: submission.id },
        data: { status: input.approved ? "APPROVED" : "REJECTED", reviewNote: input.note?.trim() || null, reviewedAt: new Date() },
      });
      const reviewTime = new Date();
      const jobUpdate = await tx.jobEngagement.updateMany({
        where: { id: job.id, status: "COMPLETION_PENDING" },
        data: input.approved
          ? { status: "COMPLETED", workSegmentStartedAt: null, workPausedAt: null }
          : { status: "IN_PROGRESS", workSegmentStartedAt: reviewTime, workPausedAt: null, workEndedAt: null },
      });
      if (jobUpdate.count !== 1) throw new ConflictException("The job status changed. Refresh and try again.");
      if (input.approved) {
        await tx.serviceRequest.update({ where: { id: requestId }, data: { status: "COMPLETED" } });
      }
      if (job.providerId) await tx.appNotification.create({
        data: {
          userId: job.providerId,
          title: input.approved ? "Job completion approved" : "Corrections requested",
          body: input.approved ? "The Skill Seeker approved the completed job." : `The Skill Seeker requested corrections: ${input.note}`,
          data: { type: input.approved ? "JOB_COMPLETION_APPROVED" : "JOB_COMPLETION_REJECTED", requestId, submissionId },
        },
      });
      return { submission: updatedSubmission, jobStatus: input.approved ? "COMPLETED" : "IN_PROGRESS" };
    });
  }

  async submitEstimate(providerId: string, requestId: string, input: SubmitEstimateDto) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (!job.providerId || job.providerId !== providerId) throw new ForbiddenException("Only the selected Provider can submit this estimate.");
      if (!["ASSESSMENT_PENDING", "ESTIMATE_REJECTED"].includes(job.status)) throw new ConflictException("An estimate cannot be submitted at this stage.");
      const hours = new Prisma.Decimal(input.estimatedHours);
      const total = hours.mul(job.hourlyRate).toDecimalPlaces(2);
      const updated = await tx.jobEngagement.update({ where: { id: job.id }, data: { estimatedHours: hours, estimatedTotal: total, estimateNotes: input.notes.trim(), estimateSubmittedAt: new Date(), estimateDecisionNote: null, status: "ESTIMATE_SUBMITTED" } });
      if (job.seekerId) await tx.appNotification.create({ data: { userId: job.seekerId, title: "Job estimate ready", body: `Your Provider submitted an estimate of R ${total.toFixed(2)} for ${hours.toString()} hours. Review and approve before work starts.`, data: { type: "ESTIMATE_SUBMITTED", requestId } } });
      return updated;
    });
  }

  async decideEstimate(seekerId: string, requestId: string, input: DecideEstimateDto) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Job estimate not found.");
      if (!job.seekerId || job.seekerId !== seekerId) throw new ForbiddenException("Only the Skill Seeker can decide this estimate.");
      if (job.status !== "ESTIMATE_SUBMITTED") throw new ConflictException("There is no estimate awaiting your decision.");
      if (!input.approved && !input.note?.trim()) throw new ConflictException("Please explain why you are rejecting the estimate.");
      const updated = await tx.jobEngagement.update({ where: { id: job.id }, data: { status: input.approved ? "ESTIMATE_APPROVED" : "ESTIMATE_REJECTED", estimateDecisionNote: input.note?.trim() || null, estimateDecidedAt: new Date() } });
      if (job.providerId) await tx.appNotification.create({ data: { userId: job.providerId, title: input.approved ? "Estimate approved" : "Estimate needs revision", body: input.approved ? "The Seeker approved your estimate. You may now start the agreed work." : `The Seeker rejected the estimate: ${input.note}`, data: { type: input.approved ? "ESTIMATE_APPROVED" : "ESTIMATE_REJECTED", requestId } } });
      return updated;
    });
  }

  async startWork(providerId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (!job.providerId || job.providerId !== providerId) throw new ForbiddenException("Only the selected Provider can start this job.");
      if (job.status !== "ESTIMATE_APPROVED") throw new ConflictException("The Seeker must approve the estimate before work can start.");
      const now = new Date();
      const claimed = await tx.jobEngagement.updateMany({
        where: { id: job.id, status: "ESTIMATE_APPROVED" },
        data: { status: "IN_PROGRESS", workStartedAt: now, workAccumulatedMs: 0, workSegmentStartedAt: now, workPausedAt: null, workEndedAt: null },
      });
      if (claimed.count !== 1) throw new ConflictException("The job status changed. Refresh and try again.");
      if (job.seekerId) await tx.appNotification.create({
        data: {
          userId: job.seekerId,
          title: "Work has started",
          body: "Your selected Provider has started work on your job.",
          data: { type: "JOB_WORK_STARTED", requestId },
        },
      });
      return tx.jobEngagement.findUniqueOrThrow({ where: { id: job.id } });
    });
  }

  async pauseWork(providerId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (job.providerId !== providerId) throw new ForbiddenException("Only the selected Provider can pause this job.");
      if (job.status !== "IN_PROGRESS") throw new ConflictException("Only an active job can be paused.");
      if (!job.workSegmentStartedAt || job.workPausedAt) throw new ConflictException("The work timer is already paused or not running.");
      const now = new Date();
      const accumulated = job.workAccumulatedMs + Math.max(0, now.getTime() - job.workSegmentStartedAt.getTime());
      const changed = await tx.jobEngagement.updateMany({
        where: { id: job.id, status: "IN_PROGRESS", workSegmentStartedAt: job.workSegmentStartedAt, workPausedAt: null },
        data: { workAccumulatedMs: accumulated, workSegmentStartedAt: null, workPausedAt: now },
      });
      if (changed.count !== 1) throw new ConflictException("The job changed. Refresh before trying again.");
      return tx.jobEngagement.findUniqueOrThrow({ where: { id: job.id } });
    });
  }

  async resumeWork(providerId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (job.providerId !== providerId) throw new ForbiddenException("Only the selected Provider can resume this job.");
      if (job.status !== "IN_PROGRESS") throw new ConflictException("Only an active job can be resumed.");
      if (!job.workPausedAt || job.workSegmentStartedAt) throw new ConflictException("The work timer is not paused.");
      const now = new Date();
      const changed = await tx.jobEngagement.updateMany({
        where: { id: job.id, status: "IN_PROGRESS", workPausedAt: job.workPausedAt, workSegmentStartedAt: null },
        data: { workSegmentStartedAt: now, workPausedAt: null },
      });
      if (changed.count !== 1) throw new ConflictException("The job changed. Refresh before trying again.");
      return tx.jobEngagement.findUniqueOrThrow({ where: { id: job.id } });
    });
  }

  async requestAdditionalHours(providerId: string, requestId: string, input: RequestAdditionalHoursDto) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (!job.providerId || job.providerId !== providerId) throw new ForbiddenException("Only the selected Provider can request extra hours.");
      if (job.status !== "IN_PROGRESS") throw new ConflictException("Extra hours can only be requested while work is in progress.");
      if (!job.workSegmentStartedAt || job.workPausedAt) throw new ConflictException("Additional hours can only be requested while the work timer is running.");
      // Claim the active timer state before creating the request so a concurrent break cannot
      // make an additional-hours request slip through after the timer has been paused.
      const timerClaim = await tx.jobEngagement.updateMany({
        where: { id: job.id, status: "IN_PROGRESS", workSegmentStartedAt: job.workSegmentStartedAt, workPausedAt: null },
        data: { workAccumulatedMs: job.workAccumulatedMs },
      });
      if (timerClaim.count !== 1) throw new ConflictException("The work timer changed. Refresh and try again.");
      const pending = await tx.jobCostAdjustment.count({ where: { engagementId: job.id, status: "PENDING" } });
      if (pending) throw new ConflictException("An additional-hours request is already awaiting the Seeker's decision.");
      const hours = new Prisma.Decimal(input.additionalHours);
      const amount = hours.mul(job.hourlyRate).toDecimalPlaces(2);
      const adjustment = await tx.jobCostAdjustment.create({ data: { engagementId: job.id, requestedHours: hours, hourlyRate: job.hourlyRate, requestedAmount: amount, reason: input.reason.trim() } });
      if (job.seekerId) await tx.appNotification.create({ data: { userId: job.seekerId, title: "Additional hours approval needed", body: `Your Provider requested ${hours.toString()} extra hours costing R ${amount.toFixed(2)}. Approval is required before this extra work.`, data: { type: "ADDITIONAL_HOURS_PENDING", requestId, adjustmentId: adjustment.id } } });
      return adjustment;
    });
  }

  async decideAdditionalHours(seekerId: string, requestId: string, adjustmentId: string, input: DecideAdditionalHoursDto) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (!job.seekerId || job.seekerId !== seekerId) throw new ForbiddenException("Only the Skill Seeker can decide additional hours.");
      const adjustment = await tx.jobCostAdjustment.findFirst({ where: { id: adjustmentId, engagementId: job.id, status: "PENDING" } });
      if (!adjustment) throw new NotFoundException("Pending additional-hours request not found.");
      if (!input.approved && !input.note?.trim()) throw new ConflictException("Please explain why you are rejecting the additional hours.");
      const updated = await tx.jobCostAdjustment.update({ where: { id: adjustment.id }, data: { status: input.approved ? "APPROVED" : "REJECTED", decisionNote: input.note?.trim() || null, decidedAt: new Date() } });
      if (job.providerId) await tx.appNotification.create({ data: { userId: job.providerId, title: input.approved ? "Additional hours approved" : "Additional hours rejected", body: input.approved ? "The Seeker approved the additional hours. You may proceed with the extra work." : `The Seeker rejected the additional hours: ${input.note}`, data: { type: input.approved ? "ADDITIONAL_HOURS_APPROVED" : "ADDITIONAL_HOURS_REJECTED", requestId, adjustmentId } } });
      return updated;
    });
  }

  async respondToRequest(providerId: string, requestId: string, input: ProviderResponseDto) {
    const provider = await this.prisma.user.findUnique({
      where: { id: providerId },
      select: { identityVerification: true, providerProfile: { select: { hourlyRate: true, assessmentFee: true } } },
    });
    if (!provider || provider.identityVerification !== "VERIFIED") {
      throw new ForbiddenException({
        code: "IDENTITY_VERIFICATION_REQUIRED",
        action: "PROVIDER_ACCEPT_REQUEST",
        message: "You can view this request, but you must complete identity verification before accepting it. Your request will remain available if it has not been taken or closed.",
      });
    }

    if (!provider.providerProfile?.hourlyRate) {
      throw new ConflictException("Complete your Provider profile and set your hourly rate before sending an offer.");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const request = await tx.serviceRequest.findUnique({
          where: { id: requestId },
          select: { id: true, seekerId: true, status: true },
        });
        if (!request) throw new NotFoundException("This service request could not be found.");
        if (!request.seekerId) throw new ConflictException("This request is no longer available.");
        if (request.seekerId === providerId) throw new ForbiddenException("You cannot respond to your own service request.");
        if (request.status !== "OPEN") throw new ConflictException("This service request is no longer available.");

        const match = await tx.requestMatch.findUnique({
          where: { requestId_providerId: { requestId, providerId } },
          select: { id: true },
        });
        if (!match) throw new ForbiddenException("This request has not been matched to your Provider profile.");

        const response = await tx.providerResponse.create({
          data: {
            requestId, providerId, message: input.message?.trim() || null, status: "OFFERED",
            hourlyRateAtOffer: provider.providerProfile!.hourlyRate!,
            assessmentFeeAtOffer: provider.providerProfile!.assessmentFee,
          },
          select: { id: true, requestId: true, status: true, message: true, hourlyRateAtOffer: true, assessmentFeeAtOffer: true, createdAt: true },
        });
        await tx.requestMatch.update({ where: { id: match.id }, data: { status: "RESPONDED" } });
        await tx.serviceRequest.update({ where: { id: requestId }, data: { matchingNextAt: null } });
        if (request.seekerId) await tx.appNotification.create({
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
      await this.retryExhaustedRequests();
      await this.dispatchPendingNotifications();
    } catch (error) {
      this.logger.error("Marketplace worker cycle failed.", error);
    } finally {
      this.workerRunning = false;
    }
  }

  private async rankedProviders(request: {
    id: string; seekerId: string; skillCategory: string; location: string | null; latitude?: number | null; longitude?: number | null; deliveryMode: string;
  }): Promise<RankedProvider[]> {
    // Do not use PostgreSQL array equality for skills here: older profiles may
    // contain title-case or differently spaced values. Normalise in application
    // code so "Plumbing", "plumbing", and " plumbing " match consistently.
    const profiles = await this.prisma.providerProfile.findMany({
      where: {
        isAvailable: true,
        user: { is: { providerRoleStatus: "ACTIVE", identityVerification: "VERIFIED" } },
        userId: { not: request.seekerId },
      },
      select: {
        userId: true,
        skillCategories: true,
        serviceAreas: true,
        deliveryModes: true,
        liveLatitude: true,
        liveLongitude: true,
        liveAccuracyM: true,
        liveLocationUpdatedAt: true,
      },
    });

    const compact = (value: string) => normalise(value).replace(/[^\p{L}\p{N}]+/gu, "");
    const requestedSkill = compact(request.skillCategory);
    const requestedArea = compact(request.location ?? "");
    const now = Date.now();
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const distanceKm = (latitude: number, longitude: number) => {
      if (request.latitude == null || request.longitude == null) return null;
      const dLat = radians(latitude - request.latitude);
      const dLon = radians(longitude - request.longitude);
      const a = Math.sin(dLat / 2) ** 2
        + Math.cos(radians(request.latitude)) * Math.cos(radians(latitude)) * Math.sin(dLon / 2) ** 2;
      return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const ranked = new Map<string, number>();
    for (const profile of profiles) {
      const hasSkill = profile.skillCategories.some((skill) => {
        const candidate = compact(skill);
        return candidate.length > 0 && candidate === requestedSkill;
      });
      if (!hasSkill) continue;

      const supportsRemote = profile.deliveryModes.includes("REMOTE") || profile.deliveryModes.includes("EITHER");
      const supportsOnsite = profile.deliveryModes.includes("ONSITE") || profile.deliveryModes.includes("EITHER");
      let score = 0;

      if (request.deliveryMode === "REMOTE" || request.deliveryMode === "EITHER") {
        if (supportsRemote) score = 110;
      }

      if ((request.deliveryMode === "ONSITE" || request.deliveryMode === "EITHER") && supportsOnsite) {
        // A saved service area is a valid coverage signal; a continuously
        // refreshed GPS location is an additional ranking signal, not a
        // mandatory prerequisite for receiving an on-site request.
        const areaMatches = requestedArea.length > 0 && profile.serviceAreas.some((area) => {
          const candidate = compact(area);
          return candidate.length >= 3 && (requestedArea.includes(candidate) || candidate.includes(requestedArea));
        });

        const hasFreshLocation = profile.liveLatitude != null
          && profile.liveLongitude != null
          && profile.liveLocationUpdatedAt != null
          && now - profile.liveLocationUpdatedAt.getTime() <= LIVE_LOCATION_MAX_AGE_MS
          && profile.liveAccuracyM != null
          && profile.liveAccuracyM <= MAX_LIVE_LOCATION_ACCURACY_M;
        const distance = hasFreshLocation
          ? distanceKm(profile.liveLatitude!, profile.liveLongitude!)
          : null;
        const isNearby = distance != null && distance <= 200;

        if (areaMatches) score = Math.max(score, 115);
        if (isNearby) score = Math.max(score, 120 + Math.max(0, 40 - Math.floor(distance!)));
      }

      if (score > 0) ranked.set(profile.userId, score);
    }

    return [...ranked.entries()]
      .map(([userId, score]) => ({ userId, score }))
      .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  }

  private async dispatchNextWave(requestId: string, wave: number, force = false) {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: { id: true, seekerId: true, skillCategory: true, location: true, latitude: true, longitude: true, deliveryMode: true, status: true, matchingStartedAt: true },
    });
    if (!request || request.status !== "OPEN") return { notified: 0, wave };
    if (!force && Date.now() - request.matchingStartedAt.getTime() >= LIVE_MATCHING_WINDOW_MS) {
      await this.prisma.serviceRequest.updateMany({ where: { id: requestId, status: "OPEN" }, data: { matchingNextAt: null } });
      return { notified: 0, wave, timedOut: true };
    }
    const seekerId = request.seekerId;
    if (!seekerId) return { notified: 0, wave };

    const ranked = await this.rankedProviders({ ...request, seekerId });
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
          title: "Incoming AnySkill service request",
          body: "A new " + request.skillCategory + " request is available. Tap to view the Seeker and job details.",
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
      where: { status: "OPEN", matchingStartedAt: { gt: new Date(now.getTime() - LIVE_MATCHING_WINDOW_MS) }, matchingNextAt: { lte: now }, matchingExhaustedAt: null },
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

  private async retryExhaustedRequests() {
    // A request with no eligible Providers should remain open and be retried
    // periodically. This also recovers requests exhausted before a Provider
    // updated their skills, coverage, verification, or availability.
    const retryBefore = new Date(Date.now() - 5 * 60 * 1000);
    const exhausted = await this.prisma.serviceRequest.findMany({
      where: {
        status: "OPEN",
        matchingStartedAt: { gt: new Date(Date.now() - LIVE_MATCHING_WINDOW_MS) },
        matchingNextAt: null,
        matchingExhaustedAt: { lte: retryBefore },
      },
      select: { id: true, matchingWave: true },
      take: 20,
      orderBy: { matchingExhaustedAt: "asc" },
    });

    for (const request of exhausted) {
      const claim = await this.prisma.serviceRequest.updateMany({
        where: {
          id: request.id,
          status: "OPEN",
          matchingNextAt: null,
          matchingExhaustedAt: { lte: retryBefore },
        },
        data: {
          matchingNextAt: new Date(Date.now() + 60_000),
          matchingExhaustedAt: null,
        },
      });
      if (claim.count === 0) continue;
      await this.dispatchNextWave(request.id, request.matchingWave + 1);
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
            channelId: (notification.data as { type?: string } | null)?.type === "MATCHED_REQUEST"
              ? "incoming_requests"
              : "default",
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
