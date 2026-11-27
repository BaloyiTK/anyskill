import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { MailService } from "../mail/mail.service";
import { LiveProviderMapService } from "./live-provider-map.service";
import {
  CreateServiceRequestDto, RespondToRequestDto,
  RegisterPushDeviceDto,
  UpdateProviderProfileDto,
  SubmitEstimateDto, DecideEstimateDto, RequestAdditionalHoursDto, DecideAdditionalHoursDto, SubmitJobCompletionDto, DecideJobCompletionDto, OpenJobDisputeDto, PostJobDisputeMessageDto, ResolveJobDisputeDto,
  UpdateHomeLocationDto, UpdateLiveLocationDto, ScheduleServiceRequestDto, SubmitProviderReviewDto, SubmitSeekerReviewDto,
} from "./dto/service-request.dto";

type RankedProvider = { userId: string; score: number };
const normalise = (value: string) => value.trim().toLocaleLowerCase("en-ZA");
const RESPONSE_WINDOW_MS = Math.max(60, Number(process.env.MATCH_RESPONSE_WINDOW_SECONDS ?? 300)) * 1000;
// Offer one ranked Provider at a time. A decline or response timeout advances to the next
// eligible Provider; if the ranked shortlist is exhausted, the matching worker retries later.
const WAVE_SIZE = 1;
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
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    // API replicas can disable the poller and run the dedicated worker entrypoint
    // instead. The default remains enabled for existing single-process installs.
    if (process.env.MARKETPLACE_WORKER_ENABLED?.trim().toLowerCase() === "false") return;
    this.worker = setInterval(() => { void this.runWorkerCycle(); }, 15_000);
    void this.runWorkerCycle();
  }

  onModuleDestroy() {
    if (this.worker) clearInterval(this.worker);
  }

  async listSkills(query: string) {
    const approvedSkills = await this.prisma.providerSkill.findMany({
      where: { status: "APPROVED", isPaused: false, user: { is: { providerRoleStatus: "ACTIVE", identityVerification: "VERIFIED" } } },
      select: { category: true }, take: 4000,
    });
    const counts = new Map<string, number>();
    for (const skillRecord of approvedSkills) {
      const skill = skillRecord.category;
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

    const request = await this.prisma.$transaction(async (tx) => {
      // Serialize request creation per Seeker so two rapid submissions cannot
      // create multiple simultaneously active service requests.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${seekerId}::uuid FOR UPDATE`;

      const existingRequest = await tx.serviceRequest.findFirst({
        where: {
          seekerId,
          OR: [
            { status: "OPEN" },
            {
              jobEngagement: {
                is: {
                  status: {
                    in: [
                      "ASSESSMENT_PENDING",
                      "ESTIMATE_SUBMITTED",
                      "ESTIMATE_REJECTED",
                      "ESTIMATE_APPROVED",
                      "IN_PROGRESS",
                      "COMPLETION_PENDING",
                      "DISPUTED",
                    ],
                  },
                },
              },
            },
          ],
        },
        select: { id: true, title: true, status: true },
        orderBy: { createdAt: "desc" },
      });
      if (existingRequest) {
        throw new ConflictException({
          code: "SEEKER_ACTIVE_REQUEST_EXISTS",
          activeRequestId: existingRequest.id,
          message: "You already have an active service request. Complete or cancel it before submitting another request.",
        });
      }

      return tx.serviceRequest.create({
        data: {
          seekerId,
          title: input.title.trim(),
          skillCategory: input.skillCategory.trim(),
          description: input.description?.trim() ?? "",
          imageUrls: input.imageUrls ?? [],
          location: input.location?.trim() || null,
          // Remote-only requests must never retain a physical location, even if a
          // client accidentally includes stale coordinates in its payload.
          latitude: input.deliveryMode === "REMOTE" ? null : input.latitude ?? null,
          longitude: input.deliveryMode === "REMOTE" ? null : input.longitude ?? null,
          searchRadiusKm: input.deliveryMode === "REMOTE" ? 10 : input.searchRadiusKm ?? 10,
          deliveryMode: input.deliveryMode,
          preferredStartAt: input.preferredStartAt ? new Date(input.preferredStartAt) : null,
          instructions: input.instructions?.trim() || null,
          // Persist a due matching timestamp with the request itself so a failed
          // immediate dispatch is recoverable by the matching worker.
          matchingNextAt: new Date(),
        },
        select: {
          id: true, title: true, skillCategory: true, description: true,
          imageUrls: true, location: true, deliveryMode: true, matchingStartedAt: true,
          preferredStartAt: true, instructions: true, status: true, createdAt: true,
        },
      });
    });

    try {
      const matching = await this.dispatchNextWave(request.id, 1);
      return { ...request, matching };
    } catch (error) {
      // The request is already committed with matchingNextAt due now. Do not
      // encourage a client retry that could create a duplicate service request.
      this.logger.error("Initial request matching failed; queued for worker retry.", error);
      return { ...request, matching: { notified: 0, wave: 0, queued: true } };
    }
  }


  async getHomeLocation(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId }, select: { homeLocationLabel: true, homeLatitude: true, homeLongitude: true } });
  }

  async updateHomeLocation(userId: string, input: UpdateHomeLocationDto) {
    return this.prisma.user.update({ where: { id: userId }, data: { homeLocationLabel: input.label.trim(), homeLatitude: input.latitude, homeLongitude: input.longitude }, select: { homeLocationLabel: true, homeLatitude: true, homeLongitude: true } });
  }

  async updateProviderLiveLocation(userId: string, input: UpdateLiveLocationDto) {
    if (input.accuracyM > MAX_LIVE_LOCATION_ACCURACY_M) throw new ConflictException("GPS accuracy is too low. Wait for a more accurate location fix (50 m or better).");
    const profile = await this.prisma.providerProfile.findUnique({ where: { userId }, select: { userId: true, isAvailable: true } });
    if (!profile) throw new NotFoundException("Create your Provider profile before sharing live location.");
    // A Provider may go offline for new matching while still sharing location
    // for a service where they explicitly tapped "I'm coming".
    if (!profile.isAvailable) {
      const enRouteJob = await this.prisma.jobEngagement.findFirst({
        where: {
          providerId: userId,
          providerEnRouteAt: { not: null },
          status: { in: ["ASSESSMENT_PENDING", "ESTIMATE_SUBMITTED", "ESTIMATE_REJECTED", "ESTIMATE_APPROVED", "IN_PROGRESS"] },
        },
        select: { id: true },
      });
      if (!enRouteJob) throw new ConflictException("Set your Provider status to Available or start navigation for an active service before sharing your live location.");
    }
    const updatedAt = new Date();
    const result = await this.prisma.providerProfile.updateMany({
      where: { userId },
      data: {
        liveLatitude: input.latitude,
        liveLongitude: input.longitude,
        liveAccuracyM: input.accuracyM,
        liveLocationUpdatedAt: updatedAt,
      },
    });
    if (result.count !== 1) throw new NotFoundException("Create your Provider profile before sharing live location.");
    this.liveProviderMap.notifyChanged();
    return { isAvailable: profile.isAvailable, liveLocationUpdatedAt: updatedAt, liveAccuracyM: input.accuracyM };
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
    const requestedSkillCategories = [...new Set(input.skillCategories.map(normalise).filter(Boolean))];
    const approvedSkillsForProfile = await this.prisma.providerSkill.findMany({
      where: { userId, status: "APPROVED", isPaused: false },
      select: { category: true, hourlyRate: true },
    });
    const approvedCategoryMap = new Map(approvedSkillsForProfile.map((skill) => [normalise(skill.category), skill.category]));
    const skillCategories = requestedSkillCategories
      .map((category) => approvedCategoryMap.get(category))
      .filter((category): category is string => Boolean(category));
    const serviceAreas = [...new Set(input.serviceAreas.map(normalise).filter(Boolean))];
    const deliveryModes = [...new Set(input.deliveryModes)];
    if (input.isAvailable && skillCategories.length === 0) {
      throw new ConflictException("Add at least one approved, active skill category before becoming available.");
    }
    if (input.isAvailable && skillCategories.some((category) => {
      const skill = approvedSkillsForProfile.find((item) => normalise(item.category) === normalise(category));
      return skill?.hourlyRate == null || Number(skill.hourlyRate) < 0.01;
    })) {
      throw new ConflictException("Set an hourly rate for every active skill under Profile → My Skills before going online.");
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
        hourlyRate: input.hourlyRate ?? null,
        assessmentFee: input.assessmentFee,
        skillCategories,
        serviceAreas,
        deliveryModes,
        isAvailable: input.isAvailable,
        ...(input.maxTravelDistanceKm != null ? { maxTravelDistanceKm: input.maxTravelDistanceKm } : {}),
        ...liveLocationData,
      },
      update: {
        publicName: input.publicName.trim(),
        ...(input.hourlyRate != null ? { hourlyRate: input.hourlyRate } : {}),
        assessmentFee: input.assessmentFee,
        skillCategories,
        serviceAreas,
        deliveryModes,
        isAvailable: input.isAvailable,
        ...(input.maxTravelDistanceKm != null ? { maxTravelDistanceKm: input.maxTravelDistanceKm } : {}),
        ...liveLocationData,
      },
      select: { publicName: true, hourlyRate: true, assessmentFee: true, skillCategories: true, serviceAreas: true, deliveryModes: true, isAvailable: true, maxTravelDistanceKm: true, liveLatitude: true, liveLongitude: true, liveAccuracyM: true, liveLocationUpdatedAt: true, updatedAt: true },
    });
    this.liveProviderMap.notifyChanged();
    if (input.isAvailable) {
      try {
        await this.rematchOpenRequestsForProvider(userId);
      } catch (error) {
        // Going online must succeed even if matching is temporarily unavailable.
        // The normal worker will recover due/exhausted requests on its next cycle.
        this.logger.error("Immediate rematch after Provider availability failed.", error);
      }
    }
    return updated;
  }

  private async rematchOpenRequestsForProvider(providerId: string) {
    const approvedSkills = await this.prisma.providerSkill.findMany({
      where: { userId: providerId, status: "APPROVED", isPaused: false },
      select: { category: true },
    });
    const categories = [...new Set(approvedSkills.map((skill) => skill.category.trim()).filter(Boolean))];
    if (categories.length === 0) return;

    const now = new Date();
    const requests = await this.prisma.serviceRequest.findMany({
      where: {
        status: "OPEN",
        matchingStartedAt: { gt: new Date(now.getTime() - LIVE_MATCHING_WINDOW_MS) },
        skillCategory: { in: categories, mode: "insensitive" },
        OR: [
          { matchingExhaustedAt: { not: null } },
          { matchingNextAt: { lte: now } },
        ],
      },
      select: { id: true, matchingWave: true },
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    for (const request of requests) {
      await this.dispatchNextWave(request.id, request.matchingWave + 1);
    }
  }

  async getProviderAvailability(userId: string) {
    const profile = await this.prisma.providerProfile.findUnique({
      where: { userId },
      select: { isAvailable: true },
    });
    return { isAvailable: profile?.isAvailable === true };
  }

  async getProviderDailyEarnings(providerId: string) {
    // South African local-day boundaries are independent of the API host timezone.
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Johannesburg",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const startOfDay = new Date(`${localDate}T00:00:00+02:00`);
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    // Earnings are recognised from completed jobs, not payment or payout status.
    // The Provider earns 90% of the approved job amount when the job is completed.
    const completedJobs = await this.prisma.jobEngagement.findMany({
      where: { providerId, status: "COMPLETED", finalApprovedAt: { gte: startOfDay, lt: endOfDay }, finalAmountDue: { not: null } },
      select: { finalAmountDue: true },
    });
    const total = completedJobs.reduce((sum, job) => sum + Number(job.finalAmountDue ?? 0) * 0.9, 0);
    return { date: localDate, currency: "ZAR", amount: Number(total.toFixed(2)), completedJobs: completedJobs.length, earningsBasis: "COMPLETED_JOBS" };
  }

  async getProviderProfile(userId: string) {
    const profile = await this.prisma.providerProfile.findUnique({
      where: { userId },
      select: { publicName: true, hourlyRate: true, assessmentFee: true, skillCategories: true, serviceAreas: true, deliveryModes: true, isAvailable: true, maxTravelDistanceKm: true, updatedAt: true },
    });
    if (!profile) return null;
    const approvedSkills = await this.prisma.providerSkill.findMany({
      where: { userId, status: "APPROVED", isPaused: false },
      select: { category: true, hourlyRate: true },
    });
    const activeSkillCategories = approvedSkills.map((skill) => skill.category);
    const [overallGroups, skillGroups] = await Promise.all([
      this.prisma.providerReview.groupBy({
        by: ["providerId"], where: { providerId: userId },
        _avg: { platformRating: true }, _count: { _all: true },
      }),
      this.prisma.providerReview.groupBy({
        by: ["providerId", "skillCategory"], where: { providerId: userId },
        _avg: { skillRating: true }, _count: { _all: true },
      }),
    ]);
    const overallGroup = overallGroups[0];
    const overallCount = overallGroup?._count._all ?? 0;
    const overall = overallGroup?._avg.platformRating ?? null;
    const skills = activeSkillCategories.map((category) => {
      const matching = skillGroups.find((group) => normalise(group.skillCategory) === normalise(category));
      const count = matching?._count._all ?? 0;
      const rating = matching?._avg.skillRating ?? null;
      return {
        category,
        rating,
        reviewCount: count,
        displayRating: rating == null ? 5 : Number(rating.toFixed(1)),
        isRated: count > 0,
      };
    });
    return {
      ...profile,
      skillCategories: activeSkillCategories,
      skillRates: approvedSkills.map((skill) => ({ category: skill.category, hourlyRate: skill.hourlyRate })),
      ratings: {
        overall: overall == null ? 5 : Number(overall.toFixed(1)),
        overallReviewCount: overallCount,
        overallIsRated: overallCount > 0,
        skills,
      },
    };
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
        liveAccuracyM: { lte: MAX_LIVE_LOCATION_ACCURACY_M },
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
          OR: [
            { status: "OPEN", matches: { some: { providerId, status: { in: ["NOTIFIED", "RESPONDED"] } } } },
            // Keep a selected response visible to its Provider long enough for
            // the app to confirm the explicit Seeker decision before navigation.
            { providerResponses: { some: { providerId, status: "SELECTED" } } },
            { providerResponses: { some: { providerId, status: "WITHDRAWN" } } },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 21,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true, seekerId: true, title: true, skillCategory: true, description: true,
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
          matches: {
            where: { providerId },
            select: { status: true, notifiedAt: true },
          },
        },
      }),
      this.prisma.providerProfile.findUnique({
        where: { userId: providerId },
        select: { liveLatitude: true, liveLongitude: true, liveAccuracyM: true, liveLocationUpdatedAt: true },
      }),
    ]);
    const seekerIds = [...new Set(
      requests.map((request) => request.seekerId).filter((id): id is string => Boolean(id)),
    )];
    const seekerRatingGroups = seekerIds.length
      ? await this.prisma.seekerReview.groupBy({
          by: ["seekerId"],
          where: { seekerId: { in: seekerIds } },
          _avg: { rating: true },
          _count: { _all: true },
        })
      : [];
    const hasMore = requests.length > 20;
    const now = Date.now();
    const hasFreshProviderLocation = providerProfile?.liveLatitude != null
      && providerProfile.liveLongitude != null
      && providerProfile.liveLocationUpdatedAt != null
      && now - providerProfile.liveLocationUpdatedAt.getTime() <= LIVE_LOCATION_MAX_AGE_MS
      && providerProfile.liveAccuracyM != null
      && providerProfile.liveAccuracyM <= MAX_LIVE_LOCATION_ACCURACY_M;
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
    const items = requests.slice(0, 20).map(({ providerResponses, seeker, matches, ...request }) => {
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
          rating: (() => {
            const group = seekerRatingGroups.find((item) => item.seekerId === request.seekerId);
            const count = group && typeof group._count === "object" ? group._count._all ?? 0 : 0;
            const average = group && typeof group._avg === "object" ? group._avg.rating ?? null : null;
            return {
              overall: average == null ? 5 : Number(average.toFixed(1)),
              reviewCount: count,
              isRated: count > 0,
            };
          })(),
        },
        providerLocation,
        distanceKm,
        alreadyResponded: providerResponses.length > 0,
        myResponse: providerResponses[0] ?? null,
        responseDeadlineAt: (() => {
          const activeMatch = matches.find((match) => match.status === "NOTIFIED");
          return activeMatch
            ? new Date(activeMatch.notifiedAt.getTime() + RESPONSE_WINDOW_MS).toISOString()
            : null;
        })(),
      };
    });
    return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
  }

  async listMyRequests(seekerId: string) {
    let failedStage = "load seeker requests and related records";
    try {
    const requests = await this.prisma.serviceRequest.findMany({
      where: { seekerId },
      orderBy: { createdAt: "desc" },
      include: {
        jobEngagement: { include: { review: true, seekerReview: true, adjustments: { orderBy: { createdAt: "desc" } }, completionSubmissions: { include: { evidenceAssets: { select: { id: true, contentType: true, originalName: true, sizeBytes: true } } }, orderBy: { submittedAt: "desc" } }, disputes: { orderBy: { createdAt: "desc" }, take: 1, include: { messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true } }, evidenceAssets: { select: { id: true, originalName: true, contentType: true, sizeBytes: true } } } } } } } },
        _count: { select: { matches: true } },
        providerResponses: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true, providerId: true, status: true, message: true, createdAt: true,
            hourlyRateAtOffer: true, assessmentFeeAtOffer: true, assessmentRequiredAtOffer: true,
            provider: {
              select: {
                phone: true,
                providerProfile: {
                  select: { publicName: true, hourlyRate: true, assessmentFee: true, skillCategories: true, serviceAreas: true, deliveryModes: true, isAvailable: true, liveLatitude: true, liveLongitude: true, liveLocationUpdatedAt: true },
                },
              },
            },
          },
        },
      },
    });
    failedStage = "prepare provider review aggregates";
    const serverNow = new Date().toISOString();
    const providerIds = [...new Set(requests.flatMap((request) =>
      request.providerResponses.map((response) => response.providerId).filter((id): id is string => Boolean(id)),
    ))];
    failedStage = "query provider review aggregates";
    const [providerOverallGroups, providerSkillGroups] = providerIds.length
      ? await Promise.all([
          this.prisma.providerReview.groupBy({
            by: ["providerId"], where: { providerId: { in: providerIds } },
            _avg: { platformRating: true }, _count: { _all: true },
          }),
          this.prisma.providerReview.groupBy({
            by: ["providerId", "skillCategory"], where: { providerId: { in: providerIds } },
            _avg: { skillRating: true }, _count: { _all: true },
          }),
        ])
      : [[], []];
    failedStage = "load provider identity and onboarding details";
    const providerUsers = providerIds.length ? await this.prisma.user.findMany({
      where: { id: { in: providerIds } },
      select: { id: true, identityVerification: true, onboardingDraft: { select: { skills: true } } },
    }) : [];
    return requests.map((request) => ({
      ...request,
      jobEngagement: request.jobEngagement ? (() => {
        const approvedAdjustments = request.jobEngagement.adjustments.filter((item) => item.status === "APPROVED");
        const approvedAdditionalHours = approvedAdjustments.reduce((sum, item) => sum + Number(item.requestedHours), 0);
        const approvedAdditionalAmount = approvedAdjustments.reduce((sum, item) => sum + Number(item.requestedAmount), 0);
        return { ...request.jobEngagement, assessmentDraftHours: undefined, assessmentDraftNotes: undefined, assessmentDraftUpdatedAt: undefined, approvedAdditionalHours, approvedAdditionalAmount: Number(approvedAdditionalAmount.toFixed(2)), agreedWorkTotal: Number((Number(request.jobEngagement.estimatedTotal ?? 0) + approvedAdditionalAmount).toFixed(2)), serverNow };
      })() : null,
      providerResponses: request.providerResponses.map((response) => {
        const profile = response.provider?.providerProfile;
        if (!profile || !response.provider || !response.providerId) return response;
        const overallGroup = providerOverallGroups.find((group) => group.providerId === response.providerId);
        const skillGroup = providerSkillGroups.find((group) => group.providerId === response.providerId
          && normalise(group.skillCategory) === normalise(request.skillCategory));
        const overallCount = overallGroup?._count._all ?? 0;
        const skillCount = skillGroup?._count._all ?? 0;
        const overall = overallGroup?._avg.platformRating ?? null;
        const skill = skillGroup?._avg.skillRating ?? null;
        const providerUser = providerUsers.find((item) => item.id === response.providerId);
        return {
          ...response,
          provider: {
            ...response.provider,
            phone: request.jobEngagement?.providerId === response.providerId
              && !["COMPLETED", "CANCELLED"].includes(request.jobEngagement.status)
              ? response.provider.phone ?? null : null,
            providerProfile: {
              publicName: profile.publicName,
              hourlyRate: profile.hourlyRate,
              assessmentFee: profile.assessmentFee,
              skillCategories: profile.skillCategories,
              serviceAreas: profile.serviceAreas,
              deliveryModes: profile.deliveryModes,
              isAvailable: profile.isAvailable,
              liveLatitude: request.jobEngagement?.providerId === response.providerId
                && !["COMPLETED", "CANCELLED"].includes(request.jobEngagement.status)
                && profile.liveLocationUpdatedAt != null
                && Date.now() - profile.liveLocationUpdatedAt.getTime() <= 60_000
                ? profile.liveLatitude : null,
              liveLongitude: request.jobEngagement?.providerId === response.providerId
                && !["COMPLETED", "CANCELLED"].includes(request.jobEngagement.status)
                && profile.liveLocationUpdatedAt != null
                && Date.now() - profile.liveLocationUpdatedAt.getTime() <= 60_000
                ? profile.liveLongitude : null,
              liveLocationUpdatedAt: request.jobEngagement?.providerId === response.providerId
                && !["COMPLETED", "CANCELLED"].includes(request.jobEngagement.status)
                && profile.liveLocationUpdatedAt != null
                && Date.now() - profile.liveLocationUpdatedAt.getTime() <= 60_000
                ? profile.liveLocationUpdatedAt : null,
              identityVerified: providerUser?.identityVerification === "VERIFIED",
              experience: (() => {
                const skills = providerUser?.onboardingDraft?.skills;
                if (!Array.isArray(skills)) return null;
                const requested = normalise(request.skillCategory).replace(/[^\p{L}\p{N}]+/gu, "");
                const entry = skills.find((item) => item && typeof item === "object" && !Array.isArray(item)
                  && normalise(String((item as Record<string, unknown>).category ?? "")).replace(/[^\p{L}\p{N}]+/gu, "") === requested) as Record<string, unknown> | undefined;
                return typeof entry?.yearsOfExperience === "string" ? entry.yearsOfExperience : entry?.yearsOfExperience == null ? null : String(entry.yearsOfExperience);
              })(),
              distanceKm: (() => {
                if (request.latitude == null || request.longitude == null || profile.liveLatitude == null || profile.liveLongitude == null) return null;
                const radians = (value: number) => value * Math.PI / 180;
                const dLat = radians(profile.liveLatitude - request.latitude);
                const dLon = radians(profile.liveLongitude - request.longitude);
                const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(request.latitude)) * Math.cos(radians(profile.liveLatitude)) * Math.sin(dLon / 2) ** 2;
                return Math.round(6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
              })(),
              ratings: {
                overall: overall == null ? 5 : Number(overall.toFixed(1)),
                overallReviewCount: overallCount,
                overallIsRated: overallCount > 0,
                requestedSkill: skill == null ? 5 : Number(skill.toFixed(1)),
                requestedSkillReviewCount: skillCount,
                requestedSkillIsRated: skillCount > 0,
              },
            },
          },
        };
      }),
    }));
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const prismaCode = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "") : "";
      this.logger.error(
        `listMyRequests failed at stage=${failedStage} error=${errorName} prismaCode=${prismaCode || "none"} message=${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  async cancelRequest(seekerId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.serviceRequest.findFirst({
        where: { id: requestId, seekerId },
        select: { id: true, title: true, status: true },
      });
      if (!request) throw new NotFoundException("This service request could not be found.");

      if (request.status === "CLOSED") {
        const job = await tx.jobEngagement.findUnique({
          where: { requestId },
          select: { id: true, providerId: true, status: true },
        });
        if (!job || !job.providerId) throw new NotFoundException("The selected service could not be found.");
        if (!["ASSESSMENT_PENDING", "ESTIMATE_SUBMITTED", "ESTIMATE_REJECTED", "ESTIMATE_APPROVED", "IN_PROGRESS", "COMPLETION_PENDING", "DISPUTED"].includes(job.status)) {
          throw new ConflictException("A service can only be cancelled before work starts.");
        }
        const changed = await tx.jobEngagement.updateMany({
          where: { id: job.id, status: job.status },
          data: { status: "CANCELLED" },
        });
        if (changed.count !== 1) throw new ConflictException("The service changed. Refresh and try again.");
        await tx.serviceRequest.updateMany({ where: { id: requestId, seekerId, status: "CLOSED" }, data: { status: "CANCELLED", matchingNextAt: null } });
        await tx.appNotification.create({
          data: {
            userId: job.providerId,
            title: "Service cancelled by Skill Seeker",
            body: `The Skill Seeker cancelled "${request.title}". You have been returned to your Provider Home screen.`,
            data: { type: "SERVICE_CANCELLED_BY_SEEKER", requestId },
          },
        });
        return { success: true, requestId, status: "CANCELLED" };
      }

      if (request.status !== "OPEN") throw new ConflictException("This request can no longer be cancelled.");
      const changed = await tx.serviceRequest.updateMany({
        where: { id: requestId, seekerId, status: "OPEN" },
        data: { status: "CANCELLED", matchingNextAt: null },
      });
      if (changed.count !== 1) throw new ConflictException("The request changed. Refresh and try again.");
      const notifiedMatches = await tx.requestMatch.findMany({
        where: { requestId, status: { in: ["NOTIFIED", "RESPONDED"] } },
        select: { providerId: true },
      });
      await tx.requestMatch.updateMany({
        where: { requestId, status: { in: ["NOTIFIED", "RESPONDED"] } },
        data: { status: "EXPIRED" },
      });
      const pendingOffers = await tx.providerResponse.findMany({
        where: { requestId, status: "OFFERED", providerId: { not: null } },
        select: { id: true, providerId: true },
      });
      await tx.providerResponse.updateMany({
        where: { requestId, status: "OFFERED" },
        data: { status: "WITHDRAWN" },
      });
      const affectedProviders = new Map<string, { responseId?: string }>();
      for (const match of notifiedMatches) {
        if (match.providerId) affectedProviders.set(match.providerId, {});
      }
      for (const offer of pendingOffers) {
        if (offer.providerId) affectedProviders.set(offer.providerId, { responseId: offer.id });
      }
      if (affectedProviders.size) await tx.appNotification.createMany({
        data: [...affectedProviders.entries()].map(([providerId, offer]) => ({
          userId: providerId,
          title: "Service request cancelled",
          body: "The Skill Seeker cancelled this request. You have been returned to Provider Home.",
          data: { type: "SERVICE_CANCELLED_BY_SEEKER", requestId, ...(offer.responseId ? { responseId: offer.responseId } : {}) },
        })),
      });
      return { success: true, requestId, status: "CANCELLED" };
    });
  }

  async markProviderEnRoute(providerId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({
        where: { requestId },
        select: {
          id: true, providerId: true, seekerId: true, status: true,
          providerEnRouteAt: true,
          request: { select: { title: true, deliveryMode: true, latitude: true, longitude: true } },
        },
      });
      if (!job || job.providerId !== providerId || !job.seekerId) throw new NotFoundException("This selected service could not be found.");
      if (job.status !== "ASSESSMENT_PENDING") throw new ConflictException("You can only confirm that you are coming during the assessment stage.");
      if (job.request.deliveryMode === "REMOTE" || job.request.latitude == null || job.request.longitude == null) {
        throw new ConflictException("This service has no on-site destination to navigate to.");
      }
      if (job.providerEnRouteAt) return { success: true, requestId, providerEnRouteAt: job.providerEnRouteAt };
      const providerEnRouteAt = new Date();
      const changed = await tx.jobEngagement.updateMany({
        where: { id: job.id, providerId, status: "ASSESSMENT_PENDING", providerEnRouteAt: null },
        data: { providerEnRouteAt },
      });
      if (changed.count !== 1) throw new ConflictException("The service changed. Refresh and try again.");
      await tx.appNotification.create({
        data: {
          userId: job.seekerId,
          title: "Your Provider is on the way",
          body: `Your Provider is coming to assess "${job.request.title}". You can now follow their live location in AnySkill.`,
          data: { type: "PROVIDER_EN_ROUTE", requestId },
        },
      });
      return { success: true, requestId, providerEnRouteAt };
    });
  }

  async markProviderArrived(providerId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({
        where: { requestId },
        select: {
          id: true, providerId: true, seekerId: true, status: true,
          providerEnRouteAt: true, providerArrivedAt: true,
          request: { select: { title: true } },
        },
      });
      if (!job || job.providerId !== providerId || !job.seekerId) throw new NotFoundException("This selected service could not be found.");
      if (job.status !== "ASSESSMENT_PENDING" || !job.providerEnRouteAt) {
        throw new ConflictException("You can only confirm arrival after starting your journey to the service location.");
      }
      if (job.providerArrivedAt) return { success: true, requestId, providerArrivedAt: job.providerArrivedAt };
      const providerArrivedAt = new Date();
      const changed = await tx.jobEngagement.updateMany({
        where: { id: job.id, providerId, status: "ASSESSMENT_PENDING", providerArrivedAt: null },
        data: { providerArrivedAt },
      });
      if (changed.count !== 1) throw new ConflictException("The service changed. Refresh and try again.");
      await tx.appNotification.create({
        data: {
          userId: job.seekerId,
          title: "Your Provider says they have arrived",
          body: `Please confirm whether your Provider has arrived at the service location for "${job.request.title}". The assessment cannot start until you confirm.`,
          data: { type: "PROVIDER_ARRIVAL_CONFIRMATION_REQUIRED", requestId },
        },
      });
      return { success: true, requestId, providerArrivedAt };
    });
  }

  async confirmProviderArrival(seekerId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({
        where: { requestId },
        select: {
          id: true, seekerId: true, providerId: true, status: true,
          providerArrivedAt: true, seekerArrivalConfirmedAt: true,
          request: { select: { title: true } },
        },
      });
      if (!job || job.seekerId !== seekerId || !job.providerId) {
        throw new NotFoundException("This selected service could not be found.");
      }
      if (job.status !== "ASSESSMENT_PENDING" || !job.providerArrivedAt) {
        throw new ConflictException("Your Provider has not reported arrival for this service.");
      }
      if (job.seekerArrivalConfirmedAt) {
        return { success: true, requestId, seekerArrivalConfirmedAt: job.seekerArrivalConfirmedAt };
      }
      const seekerArrivalConfirmedAt = new Date();
      const changed = await tx.jobEngagement.updateMany({
        where: {
          id: job.id, seekerId, status: "ASSESSMENT_PENDING",
          providerArrivedAt: { not: null }, seekerArrivalConfirmedAt: null,
        },
        data: { seekerArrivalConfirmedAt },
      });
      if (changed.count !== 1) throw new ConflictException("The service changed. Refresh and try again.");
      await tx.appNotification.create({
        data: {
          userId: job.providerId,
          title: "Seeker confirmed your arrival",
          body: `The Seeker confirmed your arrival for "${job.request.title}". You can now start the assessment.`,
          data: { type: "PROVIDER_ARRIVAL_CONFIRMED", requestId },
        },
      });
      return { success: true, requestId, seekerArrivalConfirmedAt };
    });
  }

  async startAssessment(providerId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({
        where: { requestId },
        select: { id: true, providerId: true, seekerId: true, status: true, providerArrivedAt: true, seekerArrivalConfirmedAt: true, assessmentStartedAt: true, assessmentRequired: true, request: { select: { title: true } } },
      });
      if (!job || job.providerId !== providerId || !job.seekerId) throw new NotFoundException("This selected service could not be found.");
      if (job.assessmentRequired === false) throw new ConflictException("This offer does not require an assessment. Start the agreed work after the Seeker confirms your arrival.");
      if (job.status !== "ASSESSMENT_PENDING" || !job.providerArrivedAt || !job.seekerArrivalConfirmedAt) throw new ConflictException("Wait for the Seeker to confirm your arrival before starting the assessment.");
      if (job.assessmentStartedAt) return { success: true, requestId, assessmentStartedAt: job.assessmentStartedAt };
      const assessmentStartedAt = new Date();
      const changed = await tx.jobEngagement.updateMany({
        where: { id: job.id, providerId, status: "ASSESSMENT_PENDING", providerArrivedAt: { not: null }, seekerArrivalConfirmedAt: { not: null }, assessmentStartedAt: null },
        data: { assessmentStartedAt },
      });
      if (changed.count !== 1) throw new ConflictException("The assessment stage changed. Refresh and try again.");
      await tx.appNotification.create({
        data: { userId: job.seekerId, title: "Provider started the assessment", body: `Your Provider has started assessing "${job.request.title}". They will send the final estimate when complete.`, data: { type: "ASSESSMENT_STARTED", requestId } },
      });
      return { success: true, requestId, assessmentStartedAt };
    });
  }

  async saveAssessmentDraft(providerId: string, requestId: string, input: { estimatedHours?: number | null; notes?: string }) {
    const job = await this.prisma.jobEngagement.findUnique({
      where: { requestId },
      select: { id: true, providerId: true, status: true, assessmentStartedAt: true },
    });
    if (!job) throw new NotFoundException("Selected job not found.");
    if (job.providerId !== providerId) throw new ForbiddenException("Only the selected Provider can edit this assessment.");
    if (job.status !== "ASSESSMENT_PENDING" || !job.assessmentStartedAt) {
      throw new ConflictException("Assessment drafts can only be saved while an assessment is in progress.");
    }
    if (input.estimatedHours !== undefined && input.estimatedHours !== null && (!Number.isFinite(input.estimatedHours) || input.estimatedHours < 0.25 || input.estimatedHours > 10000)) {
      throw new BadRequestException("Estimated hours must be between 0.25 and 10000.");
    }
    const updatedAt = new Date();
    const changed = await this.prisma.jobEngagement.updateMany({
      where: { id: job.id, providerId, status: "ASSESSMENT_PENDING", assessmentStartedAt: { not: null }, assessmentCompletedAt: null },
      data: {
        ...(input.estimatedHours !== undefined ? { assessmentDraftHours: input.estimatedHours === null ? null : new Prisma.Decimal(input.estimatedHours) } : {}),
        ...(input.notes !== undefined ? { assessmentDraftNotes: input.notes.trim() || null } : {}),
        assessmentDraftUpdatedAt: updatedAt,
      },
    });
    if (changed.count !== 1) throw new ConflictException("The assessment changed while saving. Refresh and try again.");
    return { success: true, requestId, assessmentDraftHours: input.estimatedHours, assessmentDraftNotes: input.notes?.trim() || null, assessmentDraftUpdatedAt: updatedAt };
  }

  async completeAssessment(providerId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({
        where: { requestId },
        select: { id: true, providerId: true, seekerId: true, status: true, assessmentStartedAt: true, assessmentCompletedAt: true, request: { select: { title: true } } },
      });
      if (!job || job.providerId !== providerId || !job.seekerId) throw new NotFoundException("This selected service could not be found.");
      if (job.status !== "ASSESSMENT_PENDING" || !job.assessmentStartedAt) throw new ConflictException("Start the assessment before marking it done.");
      if (job.assessmentCompletedAt) return { success: true, requestId, assessmentCompletedAt: job.assessmentCompletedAt };
      const assessmentCompletedAt = new Date();
      const changed = await tx.jobEngagement.updateMany({
        where: { id: job.id, providerId, status: "ASSESSMENT_PENDING", assessmentStartedAt: { not: null }, assessmentCompletedAt: null },
        data: { assessmentCompletedAt },
      });
      if (changed.count !== 1) throw new ConflictException("The assessment stage changed. Refresh and try again.");
      await tx.appNotification.create({
        data: { userId: job.seekerId, title: "Assessment completed", body: `Your Provider completed the assessment for "${job.request.title}" and is preparing the final estimate for your approval.`, data: { type: "ASSESSMENT_COMPLETED", requestId } },
      });
      return { success: true, requestId, assessmentCompletedAt };
    });
  }

  async cancelSelectedJob(providerId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({
        where: { requestId },
        select: { id: true, providerId: true, seekerId: true, status: true, request: { select: { title: true, status: true } } },
      });
      if (!job || job.providerId !== providerId || !job.seekerId) throw new NotFoundException("This selected service could not be found.");
      if (!["ASSESSMENT_PENDING", "ESTIMATE_SUBMITTED", "ESTIMATE_REJECTED", "ESTIMATE_APPROVED", "IN_PROGRESS", "COMPLETION_PENDING", "DISPUTED"].includes(job.status)) {
        throw new ConflictException("A service can only be cancelled before work starts.");
      }
      const changed = await tx.jobEngagement.updateMany({
        where: { id: job.id, providerId, status: job.status },
        data: { status: "CANCELLED" },
      });
      if (changed.count !== 1) throw new ConflictException("The service changed. Refresh and try again.");
      await tx.serviceRequest.updateMany({ where: { id: requestId, status: "CLOSED" }, data: { status: "CANCELLED", matchingNextAt: null } });
      await tx.appNotification.create({
        data: {
          userId: job.seekerId,
          title: "Service cancelled by Skill Provider",
          body: `The Skill Provider cancelled "${job.request.title}". You can now find another Provider.`,
          data: { type: "SERVICE_CANCELLED_BY_PROVIDER", requestId },
        },
      });
      return { success: true, requestId, status: "CANCELLED" };
    });
  }
  async withdrawProviderOffer(providerId: string, requestId: string, responseId: string) {
    return this.prisma.$transaction(async (tx) => {
      const response = await tx.providerResponse.findFirst({
        where: { id: responseId, requestId, providerId, status: "OFFERED" },
        select: { id: true, request: { select: { id: true, seekerId: true, status: true } } },
      });
      if (!response || !response.request.seekerId) throw new NotFoundException("This pending offer could not be found.");
      if (response.request.status !== "OPEN") throw new ConflictException("The request is no longer open for offer withdrawal.");
      const changed = await tx.providerResponse.updateMany({
        where: { id: responseId, requestId, providerId, status: "OFFERED" },
        data: { status: "WITHDRAWN" },
      });
      if (changed.count !== 1) throw new ConflictException("The Seeker has already made a decision on this offer.");
      await tx.appNotification.create({
        data: {
          userId: response.request.seekerId,
          title: "Provider withdrew an offer",
          body: "A Skill Provider has withdrawn their offer. You can continue reviewing other offers.",
          data: { type: "PROVIDER_OFFER_WITHDRAWN", requestId, responseId },
        },
      });
      return { success: true, requestId, responseId, status: "WITHDRAWN" };
    });
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

  async declineProviderOffer(seekerId: string, requestId: string, responseId: string) {
    // The offer transition and Provider notification are one atomic operation.
    // The relation predicate prevents a decline racing with Seeker selection or
    // whole-request cancellation from overwriting the winning terminal state.
    const request = await this.prisma.$transaction(async (tx) => {
      const ownedRequest = await tx.serviceRequest.findFirst({
        where: { id: requestId, seekerId, status: "OPEN" },
        select: { id: true, matchingWave: true },
      });
      if (!ownedRequest) throw new NotFoundException("This open service request could not be found.");

      const changed = await tx.providerResponse.updateMany({
        where: {
          id: responseId,
          requestId,
          status: "OFFERED",
          request: { is: { id: requestId, seekerId, status: "OPEN" } },
        },
        data: { status: "WITHDRAWN" },
      });
      if (changed.count !== 1) {
        throw new ConflictException("This Provider offer is no longer available. The request may already have been selected or cancelled.");
      }

      const offer = await tx.providerResponse.findFirst({
        where: { id: responseId, requestId, status: "WITHDRAWN" },
        select: { providerId: true },
      });
      if (offer?.providerId) {
        // A declined offer is no longer an active match. Expire its match
        // record so a later whole-request cancellation cannot notify this
        // Provider a second time as though they were still involved.
        await tx.requestMatch.updateMany({
          where: { requestId, providerId: offer.providerId, status: { in: ["NOTIFIED", "RESPONDED"] } },
          data: { status: "EXPIRED" },
        });
        await tx.appNotification.create({
          data: {
            userId: offer.providerId,
            title: "Your offer was declined",
            body: "The Skill Seeker declined your offer. You have been returned to Provider Home and can wait for another request.",
            data: { type: "PROVIDER_OFFER_DECLINED", requestId, responseId },
          },
        });
      }
      await tx.serviceRequest.updateMany({
        where: { id: requestId, seekerId, status: "OPEN" },
        data: { matchingNextAt: null, matchingExhaustedAt: null },
      });
      return ownedRequest;
    });

    // Dispatch only after the decision is committed. The worker and matching
    // lease still provide recovery if this process stops after the commit.
    const matching = await this.dispatchNextWave(requestId, request.matchingWave + 1);
    return { success: true, requestId, responseId, status: "WITHDRAWN", matching };
  }

  async selectProvider(seekerId: string, requestId: string, responseId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the request first so cancellation, competing offer selections,
      // and Provider responses serialize against the same authoritative state.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM service_requests WHERE id = ${requestId}::uuid FOR UPDATE`);
      const request = await tx.serviceRequest.findUnique({
        where: { id: requestId },
        select: { id: true, seekerId: true, skillCategory: true, status: true, title: true },
      });
      if (!request) throw new NotFoundException("This service request could not be found.");
      if (request.seekerId !== seekerId) throw new ForbiddenException("Only the Skill Seeker who created this request can select a Provider.");
      if (request.status !== "OPEN") throw new ConflictException("This request is no longer open for Provider selection.");

      const offer = await tx.providerResponse.findFirst({
        where: { id: responseId, requestId, status: "OFFERED" },
        select: { id: true, providerId: true, hourlyRateAtOffer: true, assessmentFeeAtOffer: true, assessmentRequiredAtOffer: true },
      });
      if (!offer || !offer.providerId) throw new NotFoundException("This Provider offer is no longer available.");

      // Eligibility is mutable after an offer is submitted. Recheck it at the
      // Seeker's final selection point, not only when the Provider responds.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${offer.providerId}::uuid FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM provider_skills WHERE user_id = ${offer.providerId}::uuid AND category = ${normalise(request.skillCategory)} AND status = 'APPROVED' FOR SHARE`);
      const provider = await tx.user.findUnique({
        where: { id: offer.providerId },
        select: {
          identityVerification: true,
          providerRoleStatus: true,
        },
      });
      if (!provider || provider.identityVerification !== "VERIFIED") {
        throw new ForbiddenException({
          code: "IDENTITY_VERIFICATION_REQUIRED",
          message: "This Provider is no longer identity-verified and cannot be selected.",
        });
      }
      if (provider.providerRoleStatus !== "ACTIVE") {
        throw new ForbiddenException({
          code: "PROVIDER_APPROVAL_REQUIRED",
          message: "This Provider is no longer active and cannot be selected.",
        });
      }
      const approvedSkill = await tx.providerSkill.findFirst({
        where: {
          userId: offer.providerId,
          category: normalise(request.skillCategory),
          status: "APPROVED",
          isPaused: false,
        },
        select: { id: true },
      });
      if (!approvedSkill) {
        throw new ForbiddenException({
          code: "APPROVED_SKILL_REQUIRED",
          message: "This Provider's approval for the requested skill is no longer valid.",
        });
      }
      if (offer.hourlyRateAtOffer == null) {
        throw new ConflictException("This Provider offer has no valid rate and cannot be selected.");
      }

      // A Provider may have only one selected, unfinished service at a time.
      // The Provider row is locked above so concurrent Seeker selections serialize.
      const activeJob = await tx.jobEngagement.findFirst({
        where: {
          providerId: offer.providerId,
          status: { in: ["ASSESSMENT_PENDING", "ESTIMATE_SUBMITTED", "ESTIMATE_REJECTED", "ESTIMATE_APPROVED", "IN_PROGRESS", "COMPLETION_PENDING", "DISPUTED"] },
        },
        select: { id: true },
      });
      if (activeJob) {
        throw new ConflictException("This Provider already has an active service and cannot be selected until it is completed or cancelled.");
      }

      const claimed = await tx.serviceRequest.updateMany({
        where: { id: requestId, seekerId, status: "OPEN" },
        data: { status: "CLOSED", matchingNextAt: null },
      });
      if (claimed.count !== 1) throw new ConflictException("Another selection or request update has already closed this request.");

      const selected = await tx.providerResponse.updateMany({
        where: { id: offer.id, requestId, providerId: offer.providerId, status: "OFFERED" },
        data: { status: "SELECTED" },
      });
      if (selected.count !== 1) {
        throw new ConflictException("This Provider offer was changed before selection could be completed. Refresh and try again.");
      }
      await tx.providerResponse.updateMany({
        where: { requestId, id: { not: offer.id }, status: "OFFERED" },
        data: { status: "WITHDRAWN" },
      });
      await tx.requestMatch.updateMany({
        where: { requestId, providerId: offer.providerId },
        data: { status: "RESPONDED" },
      });
      const assessmentRequired = offer.assessmentRequiredAtOffer !== false;
      await tx.jobEngagement.create({
        data: {
          requestId, responseId: offer.id, seekerId, providerId: offer.providerId,
          hourlyRate: offer.hourlyRateAtOffer,
          assessmentFee: assessmentRequired ? offer.assessmentFeeAtOffer ?? 0 : 0,
          assessmentRequired,
          ...(!assessmentRequired ? { estimatedHours: 1, estimatedTotal: offer.hourlyRateAtOffer, finalAmountDue: offer.hourlyRateAtOffer, finalApprovedAt: new Date() } : {}),
        },
      });
      await tx.appNotification.create({
        data: {
          userId: offer.providerId,
          title: "Your offer was selected",
          body: `The Skill Seeker selected your offer for: ${request.title}`,
          data: { type: "PROVIDER_SELECTED", requestId, responseId: offer.id },
        },
      });
      if (assessmentRequired) {
        await tx.appNotification.create({ data: { userId: offer.providerId, title: "Assessment required", body: `Your offer was selected for: ${request.title}. Complete the assessment and submit an estimate before starting work.`, data: { type: "ASSESSMENT_REQUIRED", requestId } } });
      } else {
        await tx.appNotification.create({ data: { userId: offer.providerId, title: "One-hour service selected", body: `Your offer was selected for: ${request.title}. This no-assessment hourly job is capped at one billable hour.`, data: { type: "ONE_HOUR_NO_ASSESSMENT_SELECTED", requestId } } });
      }
      return { success: true, requestId, selectedResponseId: offer.id, selectedProviderId: offer.providerId, status: "ASSESSMENT_PENDING" };
    });
  }


  async getProviderRoute(providerId: string, requestId: string, originLatitudeValue: string, originLongitudeValue: string) {
    const originLatitude = Number(originLatitudeValue);
    const originLongitude = Number(originLongitudeValue);
    if (!Number.isFinite(originLatitude) || originLatitude < -90 || originLatitude > 90
      || !Number.isFinite(originLongitude) || originLongitude < -180 || originLongitude > 180) {
      throw new BadRequestException("A valid current Provider location is required to calculate the route.");
    }
    const job = await this.prisma.jobEngagement.findUnique({
      where: { requestId },
      select: { providerId: true, status: true, request: { select: { latitude: true, longitude: true, deliveryMode: true } } },
    });
    if (!job || job.providerId !== providerId) throw new ForbiddenException("Only the selected Provider can view this service route.");
    if (job.request.deliveryMode === "REMOTE" || job.request.latitude == null || job.request.longitude == null) {
      throw new BadRequestException("This service does not have a physical destination.");
    }
    if (["COMPLETED", "CANCELLED"].includes(job.status)) throw new ConflictException("This service route is no longer active.");
    const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
    if (!key) throw new ServiceUnavailableException("Google Maps route directions are not configured on the AnySkill API.");
    const params = new URLSearchParams({
      origin: `${originLatitude},${originLongitude}`,
      destination: `${job.request.latitude},${job.request.longitude}`,
      mode: "driving",
      key,
    });
    const response = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`);
    if (!response.ok) throw new BadGatewayException("Google Maps could not calculate the service route.");
    const payload = await response.json() as {
      status?: string;
      routes?: Array<{ overview_polyline?: { points?: string } }>;
    };
    const encoded = payload.routes?.[0]?.overview_polyline?.points;
    if (payload.status !== "OK" || !encoded) {
      throw new BadGatewayException(payload.status === "ZERO_RESULTS"
        ? "No driving route is available for this destination."
        : "Google Maps route directions are unavailable. Check that the Directions API is enabled for the configured key.");
    }
    const coordinates: Array<{ latitude: number; longitude: number }> = [];
    let index = 0, latitude = 0, longitude = 0;
    while (index < encoded.length) {
      let result = 0, shift = 0, byte = 0;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < encoded.length);
      latitude += (result & 1) ? ~(result >> 1) : (result >> 1);
      result = 0; shift = 0;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < encoded.length);
      longitude += (result & 1) ? ~(result >> 1) : (result >> 1);
      coordinates.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
    }
    return { coordinates, destination: { latitude: job.request.latitude, longitude: job.request.longitude } };
  }

  async listMyOffers(providerId: string) {
    return this.prisma.providerResponse.findMany({
      where: { providerId, status: "OFFERED", request: { status: "OPEN" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, requestId: true, createdAt: true,
        hourlyRateAtOffer: true, assessmentFeeAtOffer: true, assessmentRequiredAtOffer: true,
        request: { select: { id: true, title: true, skillCategory: true, location: true } },
      },
    });
  }

  async listMyJobs(providerId: string) {
    const jobs = await this.prisma.jobEngagement.findMany({
      // A job is visible to its Provider only after the exact linked offer has
      // been selected by the Seeker. This also prevents orphan/stale engagements
      // from advancing the Provider from offer review into assessment.
      where: { providerId, response: { is: { providerId, status: "SELECTED" } } }, orderBy: { updatedAt: "desc" },
      include: {
        review: true,
        seekerReview: true,
        request: {
          select: {
            id: true, title: true, description: true, location: true, latitude: true, longitude: true,
            instructions: true, preferredStartAt: true, deliveryMode: true,
            seeker: { select: { phone: true, identityVerification: true, onboardingDraft: { select: { profile: true } } } },
          },
        },
        adjustments: { orderBy: { createdAt: "desc" } },
        completionSubmissions: { include: { evidenceAssets: { select: { id: true, contentType: true, originalName: true, sizeBytes: true } } }, orderBy: { submittedAt: "desc" } },
        disputes: { orderBy: { createdAt: "desc" }, take: 1, include: { messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true } }, evidenceAssets: { select: { id: true, originalName: true, contentType: true, sizeBytes: true } } } } } },
      },
    });
    const serverNow = new Date().toISOString();
    return jobs.map((job) => {
      const profile = job.request.seeker?.onboardingDraft?.profile;
      const seekerProfile = profile && typeof profile === "object" && !Array.isArray(profile)
        ? profile as Record<string, unknown> : {};
      const firstName = typeof seekerProfile.firstName === "string" ? seekerProfile.firstName.trim() : "";
      const lastName = typeof seekerProfile.lastName === "string" ? seekerProfile.lastName.trim() : "";
      const profilePhotoUrl = typeof seekerProfile.profilePhotoUrl === "string" ? seekerProfile.profilePhotoUrl.trim() : "";
      return {
        ...job,
        approvedAdditionalHours: job.adjustments.filter((item) => item.status === "APPROVED").reduce((sum, item) => sum + Number(item.requestedHours), 0),
        approvedAdditionalAmount: Number(job.adjustments.filter((item) => item.status === "APPROVED").reduce((sum, item) => sum + Number(item.requestedAmount), 0).toFixed(2)),
        agreedWorkTotal: Number((Number(job.estimatedTotal ?? 0) + job.adjustments.filter((item) => item.status === "APPROVED").reduce((sum, item) => sum + Number(item.requestedAmount), 0)).toFixed(2)),
        request: { ...job.request, seeker: undefined },
        seeker: {
          firstName, lastName, profilePhotoUrl: profilePhotoUrl || null,
          phone: job.request.seeker?.phone ?? null,
          identityVerified: job.request.seeker?.identityVerification === "VERIFIED",
        },
        serverNow,
      };
    });
  }

  async listServiceChatMessages(userId: string, requestId: string) {
    const job = await this.prisma.jobEngagement.findUnique({
      where: { requestId }, select: { seekerId: true, providerId: true },
    });
    if (!job || (job.seekerId !== userId && job.providerId !== userId)) {
      throw new ForbiddenException("Only the Seeker and selected Provider can access this service chat.");
    }
    const messages = await this.prisma.serviceChatMessage.findMany({
      where: { requestId }, orderBy: { createdAt: "asc" }, take: 200,
      select: { id: true, senderId: true, body: true, createdAt: true },
    });
    return messages.map((message) => ({ ...message, isMine: message.senderId === userId }));
  }

  async sendServiceChatMessage(userId: string, requestId: string, body: string) {
    const message = body.trim();
    if (!message || message.length > 2000) throw new BadRequestException("Enter a message of 1 to 2000 characters.");
    const job = await this.prisma.jobEngagement.findUnique({
      where: { requestId }, select: { seekerId: true, providerId: true },
    });
    if (!job || (job.seekerId !== userId && job.providerId !== userId)) {
      throw new ForbiddenException("Only the Seeker and selected Provider can send messages in this service chat.");
    }
    const saved = await this.prisma.serviceChatMessage.create({
      data: { requestId, senderId: userId, body: message },
      select: { id: true, senderId: true, body: true, createdAt: true },
    });
    const recipientId = job.seekerId === userId ? job.providerId : job.seekerId;
    if (recipientId) {
      await this.prisma.appNotification.create({
        data: {
          userId: recipientId,
          title: "New service chat message",
          body: message.length > 100 ? message.slice(0, 97) + "..." : message,
          data: { type: "SERVICE_CHAT_MESSAGE", requestId, messageId: saved.id },
        },
      });
      // Chat alerts should not wait for the next 15-second worker poll.
      // The delivery claims keep this safe if the worker is processing at the same time.
      void this.dispatchPendingNotifications().catch((error) => {
        this.logger.error("Immediate service chat notification dispatch failed.", error);
      });
    }
    return saved;
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
      const submittedEvidenceIds = input.evidenceAssetIds ?? [];
      const evidenceIds = [...new Set(submittedEvidenceIds)];
      if (evidenceIds.length !== submittedEvidenceIds.length) throw new ConflictException("Duplicate evidence files are not allowed.");
      const assets = await tx.mediaAsset.findMany({
        where: { id: { in: evidenceIds }, userId: providerId, status: "READY", purpose: "JOB_COMPLETION_EVIDENCE", completionSubmissionId: null, expiresAt: { gt: new Date() } },
        select: { id: true, objectKey: true },
      });
      if (assets.length !== evidenceIds.length) throw new ForbiddenException("One or more evidence files are unavailable, expired, or do not belong to you. Upload them again.");
      const submission = await tx.jobCompletionSubmission.create({
        data: {
          engagementId: job.id, providerId, notes: input.notes.trim(), evidenceUrls: [],
          evidenceAssets: { connect: assets.map((asset) => ({ id: asset.id, objectKey: asset.objectKey })) },
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
        data: { userId: job.seekerId, title: "Job completion submitted", body: evidenceIds.length > 0 ? "Your Provider submitted completion notes and photo evidence. Review the work in AnySkill." : "Your Provider submitted completion notes. No photos were attached. Review the work in AnySkill.", data: { type: "JOB_COMPLETION_SUBMITTED", requestId, submissionId: submission.id } },
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

      const reviewTime = new Date();
      const submissionClaim = await tx.jobCompletionSubmission.updateMany({
        where: { id: submission.id, engagementId: job.id, status: "PENDING" },
        data: { status: input.approved ? "APPROVED" : "REJECTED", reviewNote: input.note?.trim() || null, reviewedAt: reviewTime },
      });
      if (submissionClaim.count !== 1) throw new ConflictException("This completion submission has already been reviewed. Refresh to see the latest status.");

      let finalAmountDue: Prisma.Decimal | null = null;
      let providerPayoutAmount: Prisma.Decimal | null = null;
      let platformCommissionAmount: Prisma.Decimal | null = null;
      if (input.approved) {
        if (job.estimatedTotal === null) throw new ConflictException("The approved estimate is missing. Contact AnySkill support before approving completion.");
        if (!job.providerId) throw new ConflictException("This completed job has no assigned Provider and cannot be paid.");
        if (job.paymentStatus && job.paymentStatus !== "UNPAID") throw new ConflictException("Payment has already been processed for this job.");
        const approvedAdjustments = await tx.jobCostAdjustment.aggregate({
          where: { engagementId: job.id, status: "APPROVED" },
          _sum: { requestedAmount: true },
        });
        finalAmountDue = new Prisma.Decimal(job.assessmentFee).plus(job.estimatedTotal).plus(approvedAdjustments._sum.requestedAmount ?? 0).toDecimalPlaces(2);
        providerPayoutAmount = finalAmountDue.mul(new Prisma.Decimal("0.90")).toDecimalPlaces(2);
        platformCommissionAmount = finalAmountDue.minus(providerPayoutAmount).toDecimalPlaces(2);
      }

      const jobUpdate = await tx.jobEngagement.updateMany({
        where: { id: job.id, status: "COMPLETION_PENDING", finalAmountDue: null, paymentStatus: "UNPAID" },
        data: input.approved
          ? {
              status: "COMPLETED",
              workSegmentStartedAt: null,
              workPausedAt: null,
              finalAmountDue: finalAmountDue!,
              finalApprovedAt: reviewTime,
              // Completion recognises earnings; it does not confirm a debit or bank payout.
              paymentStatus: "UNPAID",
              paymentSimulatedAt: null,
              providerPayoutStatus: "NOT_SENT",
              providerPayoutSimulatedAt: null,
            }
          : { status: "IN_PROGRESS", workSegmentStartedAt: null, workPausedAt: reviewTime, workEndedAt: null },
      });
      if (jobUpdate.count !== 1) throw new ConflictException("The job status or payment changed. Refresh and try again.");

      if (input.approved) {
        // Record the job financial obligations, but do not mark a debit or payout successful.
        await tx.jobFinancialTransaction.createMany({
          data: [
            { engagementId: job.id, transactionType: "SEEKER_PAYMENT", mode: "PAYFAST_SANDBOX", status: "PENDING", amount: finalAmountDue!, currency: "ZAR", externalProvider: "PAYFAST", idempotencyKey: `${job.id}:SEEKER_PAYMENT`, initiatedAt: reviewTime },
            { engagementId: job.id, transactionType: "PROVIDER_PAYOUT", mode: "PAYFAST_SANDBOX", status: "PENDING", amount: providerPayoutAmount!, currency: "ZAR", externalProvider: "PAYFAST", idempotencyKey: `${job.id}:PROVIDER_PAYOUT`, initiatedAt: reviewTime },
            { engagementId: job.id, transactionType: "PLATFORM_COMMISSION", mode: "PAYFAST_SANDBOX", status: "PENDING", amount: platformCommissionAmount!, currency: "ZAR", externalProvider: "PAYFAST", idempotencyKey: `${job.id}:PLATFORM_COMMISSION`, initiatedAt: reviewTime },
          ],
        });
        await tx.serviceRequest.updateMany({
          where: { id: requestId, status: { not: "CANCELLED" } },
          data: { status: "CLOSED" },
        });
        const notifications = [];
        if (job.providerId) notifications.push({
          userId: job.providerId,
          title: "Job earnings recorded",
          body: `Your job earnings of R ${providerPayoutAmount!.toFixed(2)} (90%) have been recorded. The Seeker debit is awaiting successful confirmation; your bank payout has not been processed.`,
          data: { type: "JOB_EARNINGS_RECORDED", requestId, providerPayoutAmount: providerPayoutAmount!.toFixed(2), platformCommissionAmount: platformCommissionAmount!.toFixed(2) },
        });
        notifications.push({
          userId: seekerId,
          title: "Job completed",
          body: `Your approval completed the job. The job amount is R ${finalAmountDue!.toFixed(2)}. The debit must succeed before AnySkill processes the Provider 90% payout.`,
          data: { type: "JOB_COMPLETED_PAYMENT_PENDING", requestId, amount: finalAmountDue!.toFixed(2), successfulDebit: false },
        });
        await tx.appNotification.createMany({ data: notifications });
      } else if (job.providerId) {
        await tx.appNotification.create({
          data: {
            userId: job.providerId,
            title: "Corrections requested",
            body: `The Skill Seeker requested corrections: ${input.note}. The timer is paused; resume when ready to perform the corrections.`,
            data: { type: "JOB_COMPLETION_REJECTED", requestId, submissionId },
          },
        });
      }

      const updatedSubmission = await tx.jobCompletionSubmission.findUniqueOrThrow({ where: { id: submission.id } });
      return {
        submission: updatedSubmission,
        jobStatus: input.approved ? "COMPLETED" : "IN_PROGRESS",
        finalAmountDue: finalAmountDue?.toFixed(2) ?? null,
        finalApprovedAt: input.approved ? reviewTime : null,
        paymentStatus: "UNPAID",
        successfulDebit: false,
        providerPayoutStatus: "NOT_SENT",
        providerPayoutAmount: providerPayoutAmount?.toFixed(2) ?? null,
        platformCommissionAmount: platformCommissionAmount?.toFixed(2) ?? null,
        paymentMode: input.approved ? "PAYFAST_SANDBOX" : null,
        nextStep: input.approved ? "RATINGS" : "CORRECTIONS",
      };
    });
  }

  async openJobDispute(userId: string, requestId: string, input: OpenJobDisputeDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM job_engagements WHERE request_id = ${requestId}::uuid FOR UPDATE`);
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (job.seekerId !== userId && job.providerId !== userId) throw new ForbiddenException("Only the Seeker or selected Provider can open this dispute.");
      const existingDispute = await tx.jobDispute.findFirst({ where: { engagementId: job.id, status: { in: ["OPEN", "UNDER_REVIEW"] } } });
      if (existingDispute) throw new ConflictException("A dispute is already open for this job.");
      if (job.status !== "COMPLETION_PENDING") throw new ConflictException("A dispute can only be opened while completion is awaiting review.");
      const submission = await tx.jobCompletionSubmission.findFirst({ where: { engagementId: job.id, status: "PENDING" } });
      if (!submission) throw new ConflictException("There is no pending completion submission to dispute.");
      const evidenceIds = [...new Set(input.evidenceAssetIds ?? [])];
      if (evidenceIds.length !== (input.evidenceAssetIds ?? []).length) throw new ConflictException("Duplicate dispute evidence files are not allowed.");
      const assets = evidenceIds.length ? await tx.mediaAsset.findMany({
        where: { id: { in: evidenceIds }, userId, status: "READY", purpose: "JOB_DISPUTE_EVIDENCE", disputeMessageId: null, expiresAt: { gt: new Date() } },
        select: { id: true, objectKey: true },
      }) : [];
      if (assets.length !== evidenceIds.length) throw new ForbiddenException("One or more dispute evidence files are unavailable or do not belong to you.");
      const dispute = await tx.jobDispute.create({
        data: { engagementId: job.id, openedById: userId, reason: input.reason.trim(), status: "OPEN",
          messages: { create: { authorId: userId, body: input.reason.trim(), ...(evidenceIds.length ? { evidenceAssets: { connect: assets.map((asset) => ({ id: asset.id, objectKey: asset.objectKey })) } } : {}) } } },
        include: { messages: { include: { evidenceAssets: { select: { id: true, originalName: true, contentType: true, sizeBytes: true } } } } },
      });
      const claimed = await tx.jobEngagement.updateMany({ where: { id: job.id, status: "COMPLETION_PENDING" }, data: { status: "DISPUTED", workSegmentStartedAt: null, workPausedAt: new Date() } });
      if (claimed.count !== 1) throw new ConflictException("The job changed while the dispute was being opened. Refresh and try again.");
      const otherPartyId = userId === job.seekerId ? job.providerId : job.seekerId;
      if (otherPartyId) await tx.appNotification.create({ data: { userId: otherPartyId, title: "A job dispute was opened", body: "The other party opened a dispute. Submit your response and supporting evidence in AnySkill.", data: { type: "JOB_DISPUTE_OPENED", requestId, disputeId: dispute.id } } });
      return dispute;
    });
  }

  async postJobDisputeMessage(userId: string, requestId: string, disputeId: string, input: PostJobDisputeMessageDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM job_disputes WHERE id = ${disputeId}::uuid FOR UPDATE`);
      const dispute = await tx.jobDispute.findFirst({ where: { id: disputeId, engagement: { requestId } }, include: { engagement: { select: { seekerId: true, providerId: true } } } });
      if (!dispute) throw new NotFoundException("Dispute not found.");
      if (dispute.engagement.seekerId !== userId && dispute.engagement.providerId !== userId) throw new ForbiddenException("Only the Seeker and selected Provider can respond to this dispute.");
      if (!["OPEN", "UNDER_REVIEW"].includes(dispute.status)) throw new ConflictException("This dispute is no longer accepting responses.");
      const evidenceIds = [...new Set(input.evidenceAssetIds ?? [])];
      if (evidenceIds.length !== (input.evidenceAssetIds ?? []).length) throw new ConflictException("Duplicate dispute evidence files are not allowed.");
      const assets = evidenceIds.length ? await tx.mediaAsset.findMany({
        where: { id: { in: evidenceIds }, userId, status: "READY", purpose: "JOB_DISPUTE_EVIDENCE", disputeMessageId: null, expiresAt: { gt: new Date() } },
        select: { id: true, objectKey: true },
      }) : [];
      if (assets.length !== evidenceIds.length) throw new ForbiddenException("One or more dispute evidence files are unavailable or do not belong to you.");
      const message = await tx.jobDisputeMessage.create({
        data: { disputeId, authorId: userId, body: input.body.trim(), ...(evidenceIds.length ? { evidenceAssets: { connect: assets.map((asset) => ({ id: asset.id, objectKey: asset.objectKey })) } } : {}) },
        include: { evidenceAssets: { select: { id: true, originalName: true, contentType: true, sizeBytes: true } } },
      });
      await tx.jobDispute.updateMany({ where: { id: disputeId, status: "OPEN" }, data: { status: "UNDER_REVIEW" } });
      const otherPartyId = userId === dispute.engagement.seekerId ? dispute.engagement.providerId : dispute.engagement.seekerId;
      if (otherPartyId) await tx.appNotification.create({ data: { userId: otherPartyId, title: "New dispute response", body: "A new response or evidence was added to your job dispute.", data: { type: "JOB_DISPUTE_MESSAGE", requestId, disputeId } } });
      return message;
    });
  }

  async listJobDispute(userId: string, requestId: string) {
    const job = await this.prisma.jobEngagement.findUnique({ where: { requestId }, select: { id: true, seekerId: true, providerId: true } });
    if (!job) throw new NotFoundException("Selected job not found.");
    if (job.seekerId !== userId && job.providerId !== userId) throw new ForbiddenException("Only the Seeker and selected Provider can view this dispute.");
    return this.prisma.jobDispute.findFirst({
      where: { engagementId: job.id },
      orderBy: { createdAt: "desc" },
      include: { messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true } }, evidenceAssets: { select: { id: true, originalName: true, contentType: true, sizeBytes: true } } } }, resolvedBy: { select: { id: true } } },
    });
  }

  async listOpenJobDisputes() {
    return this.prisma.jobDispute.findMany({
      where: { status: { in: ["OPEN", "UNDER_REVIEW"] } }, orderBy: { createdAt: "asc" },
      include: {
        engagement: { include: { request: { select: { id: true, title: true, description: true } }, completionSubmissions: { where: { status: "PENDING" }, include: { evidenceAssets: { select: { id: true, originalName: true, contentType: true, sizeBytes: true } } } } } },
        messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true } }, evidenceAssets: { select: { id: true, originalName: true, contentType: true, sizeBytes: true } } } },
      },
    });
  }

  async resolveJobDispute(staffId: string, disputeId: string, input: ResolveJobDisputeDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM job_disputes WHERE id = ${disputeId}::uuid FOR UPDATE`);
      const dispute = await tx.jobDispute.findUnique({ where: { id: disputeId }, include: { engagement: true } });
      if (!dispute) throw new NotFoundException("Dispute not found.");
      if (staffId === dispute.engagement.seekerId || staffId === dispute.engagement.providerId) throw new ForbiddenException("A party to the dispute cannot resolve it as staff.");
      if (!["OPEN", "UNDER_REVIEW"].includes(dispute.status)) throw new ConflictException("This dispute has already been resolved.");
      const resolutionStatus = input.outcome === "PROVIDER" ? "RESOLVED_PROVIDER" : input.outcome === "SEEKER" ? "RESOLVED_SEEKER" : "RESOLVED_CANCELLED";
      const resolvedAt = new Date();
      const claimed = await tx.jobDispute.updateMany({ where: { id: disputeId, status: { in: ["OPEN", "UNDER_REVIEW"] } }, data: { status: resolutionStatus, resolutionNote: input.note.trim(), resolvedById: staffId, resolvedAt } });
      if (claimed.count !== 1) throw new ConflictException("This dispute was resolved by another staff member. Refresh to see the outcome.");
      const pendingSubmission = await tx.jobCompletionSubmission.findFirst({ where: { engagementId: dispute.engagementId, status: "PENDING" } });
      const nextJobStatus = input.outcome === "PROVIDER" ? "COMPLETED" : input.outcome === "SEEKER" ? "IN_PROGRESS" : "CANCELLED";
      let finalAmountDue: Prisma.Decimal | null = null;
      if (input.outcome === "PROVIDER") {
        if (dispute.engagement.estimatedTotal === null) throw new ConflictException("The approved estimate is missing; the dispute cannot close as Provider-completed.");
        const approvedAdjustments = await tx.jobCostAdjustment.aggregate({ where: { engagementId: dispute.engagementId, status: "APPROVED" }, _sum: { requestedAmount: true } });
        finalAmountDue = new Prisma.Decimal(dispute.engagement.assessmentFee).plus(dispute.engagement.estimatedTotal).plus(approvedAdjustments._sum.requestedAmount ?? 0).toDecimalPlaces(2);
      }
      const jobUpdate = await tx.jobEngagement.updateMany({
        where: { id: dispute.engagementId, status: "DISPUTED", finalAmountDue: null },
        data: input.outcome === "PROVIDER" ? { status: "COMPLETED", workSegmentStartedAt: null, workPausedAt: null, finalAmountDue, finalApprovedAt: resolvedAt }
          : input.outcome === "SEEKER" ? { status: "IN_PROGRESS", workSegmentStartedAt: null, workPausedAt: resolvedAt, workEndedAt: null }
          : { status: "CANCELLED", workSegmentStartedAt: null, workPausedAt: null, workEndedAt: resolvedAt },
      });
      if (jobUpdate.count !== 1) throw new ConflictException("The job is no longer in the disputed state.");
      if (pendingSubmission) await tx.jobCompletionSubmission.updateMany({ where: { id: pendingSubmission.id, status: "PENDING" }, data: { status: input.outcome === "PROVIDER" ? "APPROVED" : "REJECTED", reviewNote: input.note.trim(), reviewedAt: resolvedAt } });
      if (input.outcome !== "SEEKER") await tx.serviceRequest.updateMany({ where: { id: dispute.engagement.requestId, status: { not: "CANCELLED" } }, data: { status: input.outcome === "PROVIDER" ? "COMPLETED" : "CANCELLED" } });
      const partyIds = [dispute.engagement.seekerId, dispute.engagement.providerId].filter((id): id is string => Boolean(id));
      if (partyIds.length) await tx.appNotification.createMany({ data: partyIds.map((userId) => ({ userId, title: "Job dispute resolved", body: input.outcome === "PROVIDER" ? "AnySkill resolved the dispute in favour of the Provider. Completion is approved." : input.outcome === "SEEKER" ? "AnySkill resolved the dispute in your favour. The Provider must address the outstanding work; the timer remains paused." : "AnySkill resolved the dispute by cancelling the job.", data: { type: "JOB_DISPUTE_RESOLVED", requestId: dispute.engagement.requestId, disputeId, outcome: input.outcome } })) });
      const auditTargetId = dispute.engagement.seekerId ?? dispute.engagement.providerId;
      if (auditTargetId) await tx.staffAuditLog.create({ data: { actorId: staffId, targetUserId: auditTargetId, action: "JOB_DISPUTE_RESOLVED", metadata: { disputeId, engagementId: dispute.engagementId, outcome: input.outcome, note: input.note.trim() } } });
      return { disputeId, status: resolutionStatus, jobStatus: nextJobStatus, resolvedAt, finalAmountDue: finalAmountDue?.toFixed(2) ?? null, nextStep: input.outcome === "PROVIDER" ? "PAYMENT" : input.outcome === "SEEKER" ? "CORRECTIVE_WORK" : "CLOSED" };
    });
  }

  async simulateJobPayment(seekerId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM job_engagements WHERE request_id = ${requestId}::uuid FOR UPDATE`);
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (job.seekerId !== seekerId) throw new ForbiddenException("Only the Skill Seeker can make this payment.");
      if (job.status !== "COMPLETED" || job.finalAmountDue === null) throw new ConflictException("Approve the Provider's completion before making payment.");
      if (!job.providerId) throw new ConflictException("This completed job has no assigned Provider and cannot be paid.");
      if (job.paymentStatus === "SIMULATED_PAID") throw new ConflictException("Simulated payment has already been completed.");
      const paidAt = new Date();
      const changed = await tx.jobEngagement.updateMany({
        where: { id: job.id, status: "COMPLETED", paymentStatus: "UNPAID" },
        data: { paymentStatus: "SIMULATED_PAID", paymentSimulatedAt: paidAt, providerPayoutStatus: "PENDING", providerPayoutSimulatedAt: null },
      });
      if (changed.count !== 1) throw new ConflictException("Payment status changed. Refresh and try again.");

      // Simulate only the Seeker debit. Provider payout remains pending until a real transfer is confirmed.
      const providerAmount = job.finalAmountDue.mul("0.90").toDecimalPlaces(2);
      const commissionAmount = job.finalAmountDue.minus(providerAmount).toDecimalPlaces(2);
      await tx.jobFinancialTransaction.upsert({
        where: { engagementId_transactionType: { engagementId: job.id, transactionType: "SEEKER_PAYMENT" } },
        create: { engagementId: job.id, transactionType: "SEEKER_PAYMENT", mode: "SIMULATED", status: "COMPLETED", amount: job.finalAmountDue, currency: "ZAR", externalProvider: "ANYSKILL_SIMULATOR", idempotencyKey: `${job.id}:SEEKER_PAYMENT`, initiatedAt: paidAt, simulatedAt: paidAt, completedAt: paidAt },
        update: { mode: "SIMULATED", status: "COMPLETED", amount: job.finalAmountDue, simulatedAt: paidAt, completedAt: paidAt, failedAt: null, failureReason: null },
      });
      await tx.jobFinancialTransaction.upsert({
        where: { engagementId_transactionType: { engagementId: job.id, transactionType: "PROVIDER_PAYOUT" } },
        create: { engagementId: job.id, transactionType: "PROVIDER_PAYOUT", mode: "SIMULATED", status: "PENDING", amount: providerAmount, currency: "ZAR", externalProvider: "ANYSKILL_SIMULATOR", idempotencyKey: `${job.id}:PROVIDER_PAYOUT`, initiatedAt: paidAt, simulatedAt: paidAt },
        update: { mode: "SIMULATED", status: "PENDING", amount: providerAmount, simulatedAt: paidAt, completedAt: null, failedAt: null, failureReason: null },
      });
      await tx.jobFinancialTransaction.upsert({
        where: { engagementId_transactionType: { engagementId: job.id, transactionType: "PLATFORM_COMMISSION" } },
        create: { engagementId: job.id, transactionType: "PLATFORM_COMMISSION", mode: "SIMULATED", status: "COMPLETED", amount: commissionAmount, currency: "ZAR", externalProvider: "ANYSKILL_SIMULATOR", idempotencyKey: `${job.id}:PLATFORM_COMMISSION`, initiatedAt: paidAt, simulatedAt: paidAt, completedAt: paidAt },
        update: { mode: "SIMULATED", status: "COMPLETED", amount: commissionAmount, simulatedAt: paidAt, completedAt: paidAt, failedAt: null, failureReason: null },
      });
      await tx.appNotification.create({
        data: {
          userId: job.providerId,
          title: "Seeker debit confirmed",
          body: "The Seeker's simulated debit was successful. Your 90% payout is pending processing; no bank transfer has been made.",
          data: { type: "SIMULATED_DEBIT_CONFIRMED_PAYOUT_PENDING", requestId },
        },
      });
      return {
        success: true,
        paymentStatus: "SIMULATED_PAID",
        providerPayoutStatus: "PENDING",
        successfulDebit: true,
        providerPayoutAmount: providerAmount.toFixed(2),
        platformCommissionAmount: commissionAmount.toFixed(2),
        amount: job.finalAmountDue.toFixed(2),
        simulatedAt: paidAt,
        transactions: {
          seekerPayment: { mode: "SIMULATED", status: "COMPLETED", amount: job.finalAmountDue.toFixed(2), completedAt: paidAt },
          providerPayout: { mode: "SIMULATED", status: "PENDING", amount: providerAmount.toFixed(2), completedAt: null },
        },
      };
    });
  }

  async submitProviderReview(seekerId: string, requestId: string, input: SubmitProviderReviewDto) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({
        where: { requestId },
        include: { request: { select: { skillCategory: true } } },
      });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (job.seekerId !== seekerId) throw new ForbiddenException("Only the Skill Seeker assigned to this completed job can rate the Provider.");
      if (job.status !== "COMPLETED" || !["SIMULATED_PAID", "PAYFAST_PAID"].includes(job.paymentStatus)) throw new ConflictException("Complete payment before rating the Provider.");
      if (!job.providerId) throw new ConflictException("This job has no Provider available to rate.");
      const review = await tx.providerReview.create({
        data: {
          engagementId: job.id, seekerId, providerId: job.providerId,
          skillCategory: job.request.skillCategory, skillRating: input.skillRating,
          platformRating: input.platformRating, comment: input.comment?.trim() || null,
        },
      });
      const [providerReview, seekerReview] = await Promise.all([
        tx.providerReview.count({ where: { engagementId: job.id } }),
        tx.seekerReview.count({ where: { engagementId: job.id } }),
      ]);
      if (providerReview > 0 && seekerReview > 0) {
        await tx.serviceRequest.updateMany({ where: { id: requestId, status: "CLOSED" }, data: { status: "COMPLETED" } });
      }
      return { success: true, review, requestClosed: providerReview > 0 && seekerReview > 0 };
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("You have already rated this completed job.");
      throw error;
    });
  }

  async submitSeekerReview(providerId: string, requestId: string, input: SubmitSeekerReviewDto) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (job.providerId !== providerId) throw new ForbiddenException("Only the Provider assigned to this job can rate the Skill Seeker.");
      if (job.status !== "COMPLETED" || !["SIMULATED_PAID", "PAYFAST_PAID"].includes(job.paymentStatus)) throw new ConflictException("Wait until payment is completed before rating the Skill Seeker.");
      if (!job.seekerId) throw new ConflictException("This job has no Skill Seeker available to rate.");
      const review = await tx.seekerReview.create({
        data: { engagementId: job.id, providerId, seekerId: job.seekerId, rating: input.rating, comment: input.comment?.trim() || null },
      });
      const [providerReview, seekerReview] = await Promise.all([
        tx.providerReview.count({ where: { engagementId: job.id } }),
        tx.seekerReview.count({ where: { engagementId: job.id } }),
      ]);
      if (providerReview > 0 && seekerReview > 0) {
        await tx.serviceRequest.updateMany({ where: { id: requestId, status: "CLOSED" }, data: { status: "COMPLETED" } });
      }
      return { success: true, review, requestClosed: providerReview > 0 && seekerReview > 0 };
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("You have already rated this Skill Seeker for this completed job.");
      throw error;
    });
  }

  async submitEstimate(providerId: string, requestId: string, input: SubmitEstimateDto) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (!job.providerId || job.providerId !== providerId) throw new ForbiddenException("Only the selected Provider can submit this estimate.");
      if (job.assessmentRequired === false) throw new ConflictException("This no-assessment offer has a fixed one-hour billing cap and does not accept a later estimate.");
      if (!["ASSESSMENT_PENDING", "ESTIMATE_REJECTED"].includes(job.status)) throw new ConflictException("An estimate cannot be submitted at this stage.");
      if (job.status === "ASSESSMENT_PENDING" && !job.assessmentCompletedAt) throw new ConflictException("Complete the assessment before submitting the final estimate.");
      const hours = new Prisma.Decimal(input.estimatedHours);
      const total = hours.mul(job.hourlyRate).toDecimalPlaces(2);
      // Claim the transition with a conditional write. Two simultaneous estimate
      // submissions must not overwrite one another after both read the same status.
      const submittedAt = new Date();
      const claimed = await tx.jobEngagement.updateMany({
        where: { id: job.id, providerId, status: job.status },
        data: { estimatedHours: hours, estimatedTotal: total, estimateNotes: input.notes.trim(), assessmentDraftHours: null, assessmentDraftNotes: null, assessmentDraftUpdatedAt: null, estimateSubmittedAt: submittedAt, estimateDecisionNote: null, status: "ESTIMATE_SUBMITTED" },
      });
      if (claimed.count !== 1) throw new ConflictException("The engagement changed while you were submitting the estimate. Refresh and try again.");
      const updated = await tx.jobEngagement.findUniqueOrThrow({ where: { id: job.id } });
      if (job.seekerId) {
        const finalEstimateTotal = total.plus(job.assessmentFee).toDecimalPlaces(2);
        await tx.appNotification.create({ data: { userId: job.seekerId, title: "Final price ready for approval", body: `Your Provider submitted a final price of R ${finalEstimateTotal.toFixed(2)}: R ${total.toFixed(2)} labour at your agreed rate of R ${job.hourlyRate.toFixed(2)}/hour, plus R ${job.assessmentFee.toFixed(2)} assessment fee. Review and approve before work starts.`, data: { type: "ESTIMATE_SUBMITTED", requestId } } });
      }
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
      // Only one Seeker decision may win. A second device/tap must not reverse
      // an approval or rejection that has already committed.
      const decidedAt = new Date();
      const claimed = await tx.jobEngagement.updateMany({
        where: { id: job.id, seekerId, status: "ESTIMATE_SUBMITTED" },
        data: { status: input.approved ? "ESTIMATE_APPROVED" : "ESTIMATE_REJECTED", estimateDecisionNote: input.note?.trim() || null, estimateDecidedAt: decidedAt },
      });
      if (claimed.count !== 1) throw new ConflictException("The estimate has already been decided or changed. Refresh to see the latest status.");
      const updated = await tx.jobEngagement.findUniqueOrThrow({ where: { id: job.id } });
      if (job.providerId) await tx.appNotification.create({ data: { userId: job.providerId, title: input.approved ? "Estimate approved" : "Estimate needs revision", body: input.approved ? "The Seeker approved your estimate. You may now start the agreed work." : `The Seeker rejected the estimate: ${input.note}`, data: { type: input.approved ? "ESTIMATE_APPROVED" : "ESTIMATE_REJECTED", requestId } } });
      return updated;
    });
  }

  async startWork(providerId: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (!job.providerId || job.providerId !== providerId) throw new ForbiddenException("Only the selected Provider can start this job.");
      const noAssessmentStart = job.status === "ASSESSMENT_PENDING" && job.assessmentRequired === false && !!job.seekerArrivalConfirmedAt;
      if (job.status !== "ESTIMATE_APPROVED" && !noAssessmentStart) throw new ConflictException("The Seeker must confirm arrival for a no-assessment job or approve the estimate before work can start.");
      const now = new Date();
      const claimed = await tx.jobEngagement.updateMany({
        where: { id: job.id, status: job.status, ...(noAssessmentStart ? { assessmentRequired: false, seekerArrivalConfirmedAt: { not: null } } : {}) },
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
      const pendingAdjustments = await tx.jobCostAdjustment.count({ where: { engagementId: job.id, status: "PENDING" } });
      if (pendingAdjustments > 0) throw new ConflictException("Resolve the pending additional-hours request before resuming the work timer.");
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
      await tx.$queryRaw(Prisma.sql`SELECT id FROM job_engagements WHERE request_id = ${requestId}::uuid FOR UPDATE`);
      const job = await tx.jobEngagement.findUnique({ where: { requestId } });
      if (!job) throw new NotFoundException("Selected job not found.");
      if (!job.providerId || job.providerId !== providerId) throw new ForbiddenException("Only the selected Provider can request extra hours.");
      if (job.status !== "IN_PROGRESS") throw new ConflictException("Extra hours can only be requested while work is in progress.");
      if (job.assessmentRequired === false) throw new ConflictException("This no-assessment hourly offer is capped at one billable hour. Additional hours cannot be requested or charged.");
      if (!job.workSegmentStartedAt || job.workPausedAt) throw new ConflictException("Additional hours can only be requested while the work timer is running.");
      // Claim the active timer state before creating the request so a concurrent break cannot
      // make an additional-hours request slip through after the timer has been paused.
      const requestedAt = new Date();
      const accumulatedWorkMs = job.workAccumulatedMs + Math.max(0, requestedAt.getTime() - job.workSegmentStartedAt.getTime());
      const timerClaim = await tx.jobEngagement.updateMany({
        where: { id: job.id, status: "IN_PROGRESS", workSegmentStartedAt: job.workSegmentStartedAt, workPausedAt: null },
        data: { workAccumulatedMs: accumulatedWorkMs, workSegmentStartedAt: null, workPausedAt: requestedAt },
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
      if (job.status !== "IN_PROGRESS" || !job.workPausedAt || job.workSegmentStartedAt) throw new ConflictException("The job must remain paused while the additional-hours decision is pending.");
      const adjustment = await tx.jobCostAdjustment.findFirst({ where: { id: adjustmentId, engagementId: job.id, status: "PENDING" } });
      if (!adjustment) throw new NotFoundException("Pending additional-hours request not found.");
      if (!input.approved && !input.note?.trim()) throw new ConflictException("Please explain why you are rejecting the additional hours.");
      const claimed = await tx.jobCostAdjustment.updateMany({
        where: { id: adjustment.id, engagementId: job.id, status: "PENDING" },
        data: { status: input.approved ? "APPROVED" : "REJECTED", decisionNote: input.note?.trim() || null, decidedAt: new Date() },
      });
      if (claimed.count !== 1) throw new ConflictException("The additional-hours request has already been decided. Refresh to see the latest status.");
      const updated = await tx.jobCostAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } });
      if (job.providerId) await tx.appNotification.create({ data: { userId: job.providerId, title: input.approved ? "Additional hours approved" : "Additional hours rejected", body: input.approved ? "The Seeker approved the additional hours. The timer remains paused; resume it when ready to continue." : `The Seeker rejected the additional hours: ${input.note}. The timer remains paused; resume to continue the previously approved scope.`, data: { type: input.approved ? "ADDITIONAL_HOURS_APPROVED" : "ADDITIONAL_HOURS_REJECTED", requestId, adjustmentId } } });
      return { ...updated, workPaused: true, resumeRequired: true };
    });
  }

  async declineIncomingRequest(providerId: string, requestId: string) {
    const matchingWave = await this.prisma.$transaction(async (tx) => {
      const request = await tx.serviceRequest.findFirst({
        where: { id: requestId, status: "OPEN" },
        select: { matchingWave: true },
      });
      if (!request) throw new ConflictException("This incoming request is no longer awaiting your response.");

      const changed = await tx.requestMatch.updateMany({
        where: {
          requestId,
          providerId,
          status: "NOTIFIED",
          request: { status: "OPEN" },
        },
        data: { status: "EXPIRED" },
      });
      if (changed.count !== 1) {
        throw new ConflictException("This incoming request is no longer awaiting your response.");
      }

      await tx.providerResponse.create({
        data: { requestId, providerId, status: "DECLINED" },
      });
      await tx.serviceRequest.updateMany({
        where: { id: requestId, status: "OPEN" },
        data: { matchingNextAt: new Date() },
      });
      return request.matchingWave;
    });

    // An explicit decline should advance matching immediately, not wait for the
    // standard response window to expire.
    const matching = await this.dispatchNextWave(requestId, matchingWave + 1);
    return { success: true, requestId, status: "DECLINED", matching };
  }

  async respondToRequest(providerId: string, requestId: string, input: RespondToRequestDto = {}) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialize acceptance with cancellation and Seeker selection. Those
        // operations all update this request row, so the lock makes the
        // subsequent status read authoritative rather than a stale snapshot.
        await tx.$queryRaw(Prisma.sql`SELECT id FROM service_requests WHERE id = ${requestId}::uuid FOR UPDATE`);
        const request = await tx.serviceRequest.findUnique({
          where: { id: requestId },
          select: { id: true, seekerId: true, skillCategory: true, status: true },
        });
        if (!request) throw new NotFoundException("This service request could not be found.");
        if (!request.seekerId) throw new ConflictException("This request is no longer available.");
        if (request.seekerId === providerId) throw new ForbiddenException("You cannot respond to your own service request.");
        if (request.status !== "OPEN") throw new ConflictException("This service request is no longer available.");

        const match = await tx.requestMatch.findUnique({
          where: { requestId_providerId: { requestId, providerId } },
          select: { id: true, status: true, notifiedAt: true },
        });
        if (!match) throw new ForbiddenException("This request has not been matched to your Provider profile.");
        if (match.status !== "NOTIFIED") {
          throw new ConflictException("This incoming request is no longer awaiting your response.");
        }
        if (Date.now() >= match.notifiedAt.getTime() + RESPONSE_WINDOW_MS) {
          throw new ConflictException("The response window has expired. AnySkill is finding the next available Provider.");
        }

        await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${providerId}::uuid FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM provider_skills WHERE user_id = ${providerId}::uuid AND category = ${normalise(request.skillCategory)} AND status = 'APPROVED' FOR SHARE`);
        const provider = await tx.user.findUnique({
          where: { id: providerId },
          select: {
            identityVerification: true,
            providerRoleStatus: true,
            providerProfile: { select: { assessmentFee: true } },
          },
        });
        if (!provider || provider.identityVerification !== "VERIFIED") {
          throw new ForbiddenException({
            code: "IDENTITY_VERIFICATION_REQUIRED",
            action: "PROVIDER_ACCEPT_REQUEST",
            message: "Complete identity verification before responding to this request.",
          });
        }
        if (provider.providerRoleStatus !== "ACTIVE") {
          throw new ForbiddenException({
            code: "PROVIDER_APPROVAL_REQUIRED",
            message: "Your Provider account must be approved and active before responding to requests.",
          });
        }
        // Locking the Provider row serializes responses to different requests.
        // Do not let a Provider accumulate another active service or outstanding offer.
        const [activeJob, activeOffer, activeIncomingMatch] = await Promise.all([
          tx.jobEngagement.findFirst({
            where: {
              providerId,
              status: { in: ["ASSESSMENT_PENDING", "ESTIMATE_SUBMITTED", "ESTIMATE_REJECTED", "ESTIMATE_APPROVED", "IN_PROGRESS", "COMPLETION_PENDING", "DISPUTED"] },
            },
            select: { id: true },
          }),
          tx.providerResponse.findFirst({
            where: { providerId, status: "OFFERED", request: { status: "OPEN" } },
            select: { id: true },
          }),
          tx.requestMatch.findFirst({
            where: { providerId, status: { in: ["NOTIFIED", "RESPONDED"] }, request: { status: "OPEN" }, requestId: { not: requestId } },
            select: { id: true },
          }),
        ]);
        if (activeJob) {
          throw new ConflictException("You already have an active service. Complete or cancel it before accepting another request.");
        }
        if (activeOffer || activeIncomingMatch) {
          throw new ConflictException("You already have another incoming request or pending offer. Respond to it before accepting another request.");
        }

        const approvedSkill = await tx.providerSkill.findFirst({
          where: {
            userId: providerId,
            category: normalise(request.skillCategory),
            status: "APPROVED",
            isPaused: false,
          },
          select: { id: true, hourlyRate: true },
        });
        if (!approvedSkill) {
          throw new ForbiddenException({
            code: "APPROVED_SKILL_REQUIRED",
            message: "Your requested skill is no longer approved. Update your skills or wait for approval before responding.",
          });
        }

        if (approvedSkill.hourlyRate == null || !Number.isFinite(Number(approvedSkill.hourlyRate)) || Number(approvedSkill.hourlyRate) < 0.01) {
          throw new ConflictException("Set an hourly rate for this skill in Profile → My Skills before sending an offer.");
        }

        // Compare-and-set the match before creating an offer. A stale or
        // concurrently changed match cannot be revived as RESPONDED.
        const claimed = await tx.requestMatch.updateMany({
          where: { id: match.id, requestId, providerId, status: "NOTIFIED" },
          data: { status: "RESPONDED" },
        });
        if (claimed.count !== 1) {
          throw new ConflictException("This incoming request is no longer awaiting your response. Refresh and try again.");
        }
        // Assessment need and assessment price are separate Provider decisions.
        // A zero-fee assessment is still a full assessment/estimate journey.
        // Older clients that omit these fields default to assessment required
        // and retain the Provider's configured profile fee.
        const configuredAssessmentFee = Number(provider.providerProfile?.assessmentFee ?? 0);
        const assessmentRequired = input.assessmentRequired ?? configuredAssessmentFee > 0;
        const assessmentFee = assessmentRequired
          ? input.assessmentFee ?? configuredAssessmentFee
          : 0;
        if (!Number.isFinite(assessmentFee) || assessmentFee < 0 || assessmentFee > 1000000) {
          throw new BadRequestException("Enter a valid assessment fee of R0 or more.");
        }
        const response = await tx.providerResponse.create({
          data: {
            requestId,
            providerId,
            message: null,
            status: "OFFERED",
            hourlyRateAtOffer: approvedSkill.hourlyRate,
            assessmentFeeAtOffer: assessmentFee,
            assessmentRequiredAtOffer: assessmentRequired,
          },
          select: { id: true, requestId: true, status: true, message: true, hourlyRateAtOffer: true, assessmentFeeAtOffer: true, assessmentRequiredAtOffer: true, createdAt: true },
        });
        const requestUpdated = await tx.serviceRequest.updateMany({
          where: { id: requestId, seekerId: request.seekerId, status: "OPEN" },
          data: { matchingNextAt: null },
        });
        if (requestUpdated.count !== 1) {
          throw new ConflictException("This service request is no longer available. Refresh your requests.");
        }
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
      // Recover work left in-flight by a process crash. Network requests are
      // bounded by a 12-second timeout, so a two-minute lease is conservative.
      const staleBefore = new Date(Date.now() - 2 * 60_000);
      await this.prisma.appNotification.updateMany({
        where: { deliveryStatus: "SENDING", deliveryStartedAt: { lt: staleBefore } },
        data: { deliveryStatus: "PENDING", deliveryStartedAt: null },
      });
      await this.prisma.notificationDeviceDelivery.updateMany({
        where: { status: "SENDING", updatedAt: { lt: staleBefore }, attempts: { lt: 5 } },
        data: { status: "PENDING", nextAttemptAt: new Date() },
      });
      await this.prisma.notificationDeviceDelivery.updateMany({
        where: { status: "SENDING", updatedAt: { lt: staleBefore }, attempts: { gte: 5 } },
        data: { status: "FAILED", lastError: "Delivery worker stopped before completing this attempt." },
      });
      await this.prisma.welcomeEmailOutbox.updateMany({
        where: { status: "SENDING", updatedAt: { lt: staleBefore }, attempts: { lt: 5 } },
        data: { status: "PENDING", nextAttemptAt: new Date(), lastError: "Email worker stopped before completing this attempt." },
      });
      await this.prisma.welcomeEmailOutbox.updateMany({
        where: { status: "SENDING", updatedAt: { lt: staleBefore }, attempts: { gte: 5 } },
        data: { status: "FAILED", lastError: "Email worker stopped after the maximum number of attempts." },
      });
      await this.expandExpiredWaves();
      await this.retryExhaustedRequests();
      await this.dispatchPendingNotifications();
      await this.dispatchPendingWelcomeEmails();
      await this.pollExpoPushReceipts();
    } catch (error) {
      this.logger.error("Marketplace worker cycle failed.", error);
    } finally {
      this.workerRunning = false;
    }
  }

  private async dispatchPendingWelcomeEmails() {
    const pending = await this.prisma.welcomeEmailOutbox.findMany({
      where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
      take: 20,
      orderBy: { createdAt: "asc" },
      select: {
        id: true, recipientEmail: true, displayName: true,
        providerReviewPending: true, attempts: true,
      },
    });

    for (const email of pending) {
      const claim = await this.prisma.welcomeEmailOutbox.updateMany({
        where: { id: email.id, status: "PENDING", attempts: email.attempts },
        data: { status: "SENDING", attempts: { increment: 1 } },
      });
      if (claim.count !== 1) continue;

      const attempts = email.attempts + 1;
      try {
        await this.mail.sendWelcomeEmail(email.recipientEmail, email.displayName, email.providerReviewPending);
        await this.prisma.welcomeEmailOutbox.updateMany({
          where: { id: email.id, status: "SENDING" },
          data: { status: "SENT", sentAt: new Date(), lastError: null },
        });
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
          ? error.code.slice(0, 64)
          : "unknown";
        const delayMs = Math.min(60 * 60_000, 15_000 * (2 ** Math.max(0, attempts - 1)));
        await this.prisma.welcomeEmailOutbox.updateMany({
          where: { id: email.id, status: "SENDING" },
          data: {
            status: attempts >= 5 ? "FAILED" : "PENDING",
            nextAttemptAt: new Date(Date.now() + delayMs),
            lastError: code,
          },
        });
        this.logger.warn(`Welcome email delivery failed for outbox ${email.id} on attempt ${attempts}/5 (code=${code}).`);
      }
    }
  }

  private async rankedProviders(request: {
    id: string; seekerId: string; skillCategory: string; location: string | null;
    latitude?: number | null; longitude?: number | null; deliveryMode: string; searchRadiusKm: number;
  }): Promise<RankedProvider[]> {
    const profiles = await this.prisma.providerProfile.findMany({
      where: {
        isAvailable: true,
        user: { is: { providerRoleStatus: "ACTIVE", identityVerification: "VERIFIED" } },
        userId: { not: request.seekerId },
      },
      select: {
        userId: true, skillCategories: true, deliveryModes: true, maxTravelDistanceKm: true,
        liveLatitude: true, liveLongitude: true, liveAccuracyM: true, liveLocationUpdatedAt: true,
        user: {
          select: {
            onboardingDraft: { select: { skills: true } },
            // ProviderSkill is the authoritative approval record. Do not rely
            // on the denormalized profile skill list for match eligibility.
            providerSkills: {
              where: { status: "APPROVED", isPaused: false },
              select: { category: true },
            },
          },
        },
      },
    });
    const compact = (value: string) => normalise(value).replace(/[^\p{L}\p{N}]+/gu, "");
    const requestedSkill = compact(request.skillCategory);
    const matchingProfiles = profiles.filter((profile) =>
      profile.user.providerSkills.some((skill) => compact(skill.category) === requestedSkill),
    );
    if (!matchingProfiles.length) return [];
    const providerIds = matchingProfiles.map((profile) => profile.userId);
    const [completedCounts, skillRatingGroups, overallRatingGroups] = await Promise.all([
      this.prisma.jobEngagement.groupBy({
        by: ["providerId"],
        where: {
          providerId: { in: providerIds }, status: "COMPLETED",
          request: { is: { skillCategory: { equals: request.skillCategory, mode: "insensitive" } } },
        },
        _count: { _all: true },
      }),
      this.prisma.providerReview.groupBy({
        by: ["providerId", "skillCategory"], where: { providerId: { in: providerIds } },
        _avg: { skillRating: true }, _count: { _all: true },
      }),
      this.prisma.providerReview.groupBy({
        by: ["providerId"], where: { providerId: { in: providerIds } },
        _avg: { platformRating: true }, _count: { _all: true },
      }),
    ]);
    const completedByProvider = new Map(completedCounts.filter((item) => item.providerId != null).map((item) => [item.providerId!, item._count._all]));
    const experienceYearsForSkill = (skillsValue: unknown): number => {
      if (!Array.isArray(skillsValue)) return 0;
      const entry = skillsValue.find((item) => item && typeof item === "object" && !Array.isArray(item)
        && compact(String((item as Record<string, unknown>).category ?? "")) === requestedSkill) as Record<string, unknown> | undefined;
      const match = String(entry?.yearsOfExperience ?? "").match(/\d+/);
      return match ? Number(match[0]) : 0;
    };
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const distanceFromSeeker = (latitude: number, longitude: number) => {
      if (request.latitude == null || request.longitude == null) return null;
      const dLat = radians(latitude - request.latitude), dLon = radians(longitude - request.longitude);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(request.latitude)) * Math.cos(radians(latitude)) * Math.sin(dLon / 2) ** 2;
      return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    const now = Date.now();
    const eligible: Array<{ userId: string; score: number; distanceKm: number | null }> = [];
    for (const profile of matchingProfiles) {
      const supportsRemote = profile.deliveryModes.includes("REMOTE") || profile.deliveryModes.includes("EITHER");
      const supportsOnsite = profile.deliveryModes.includes("ONSITE") || profile.deliveryModes.includes("EITHER");
      let distance: number | null = null;
      let onsiteEligible = false;
      if ((request.deliveryMode === "ONSITE" || request.deliveryMode === "EITHER") && supportsOnsite) {
        const fresh = profile.liveLatitude != null && profile.liveLongitude != null && profile.liveLocationUpdatedAt != null
          && now - profile.liveLocationUpdatedAt.getTime() <= LIVE_LOCATION_MAX_AGE_MS
          && profile.liveAccuracyM != null && profile.liveAccuracyM <= MAX_LIVE_LOCATION_ACCURACY_M;
        distance = fresh ? distanceFromSeeker(profile.liveLatitude!, profile.liveLongitude!) : null;
        onsiteEligible = distance != null && distance <= Math.min(request.searchRadiusKm, profile.maxTravelDistanceKm);
      }
      const remoteEligible = (request.deliveryMode === "REMOTE" && supportsRemote) || (request.deliveryMode === "EITHER" && supportsRemote);
      if (!onsiteEligible && !remoteEligible) continue;
      const skillGroup = skillRatingGroups.find((group) => group.providerId === profile.userId
        && compact(group.skillCategory) === requestedSkill);
      const overallGroup = overallRatingGroups.find((group) => group.providerId === profile.userId);
      const skillCount = skillGroup?._count._all ?? 0;
      const overallCount = overallGroup?._count._all ?? 0;
      const skillMean = (((skillGroup?._avg.skillRating ?? 5) * skillCount) + 5 * 3) / (skillCount + 3);
      const overallMean = (((overallGroup?._avg.platformRating ?? 5) * overallCount) + 5 * 3) / (overallCount + 3);
      const completedJobs = completedByProvider.get(profile.userId) ?? 0;
      const experience = experienceYearsForSkill(profile.user.onboardingDraft?.skills);
      const radius = Math.min(request.searchRadiusKm, profile.maxTravelDistanceKm);
      const distanceScore = onsiteEligible && distance != null ? Math.max(0, 1 - distance / Math.max(radius, 1)) : 1;
      const jobScore = Math.min(1, Math.log1p(completedJobs) / Math.log1p(50));
      const experienceScore = Math.min(1, experience / 10);
      // Bayesian prior of three 5-star reviews protects new providers from a zero-review penalty.
      const score = (skillMean / 5) * 45 + (overallMean / 5) * 15
        + jobScore * 20 + distanceScore * 10 + experienceScore * 10;
      eligible.push({ userId: profile.userId, score: Math.round(score * 100), distanceKm: onsiteEligible ? distance : null });
    }
    eligible.sort((a, b) => b.score - a.score
      || (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY)
      || a.userId.localeCompare(b.userId));
    return eligible.map((provider) => ({ userId: provider.userId, score: provider.score }));
  }

  private async dispatchNextWave(requestId: string, wave: number, force = false) {
    const requestSnapshot = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: { id: true, seekerId: true, skillCategory: true, location: true, latitude: true, longitude: true, searchRadiusKm: true, deliveryMode: true, status: true, matchingStartedAt: true, matchingWave: true },
    });
    if (!requestSnapshot || requestSnapshot.status !== "OPEN") return { notified: 0, wave };
    if (requestSnapshot.matchingWave >= wave) {
      return { notified: 0, wave: requestSnapshot.matchingWave, alreadyDispatched: true };
    }
    if (!force && Date.now() - requestSnapshot.matchingStartedAt.getTime() >= LIVE_MATCHING_WINDOW_MS) {
      await this.prisma.serviceRequest.updateMany({ where: { id: requestId, status: "OPEN" }, data: { matchingNextAt: null } });
      return { notified: 0, wave, timedOut: true };
    }
    const seekerId = requestSnapshot.seekerId;
    if (!seekerId) return { notified: 0, wave };

    // Ranking is read-only. The request and Provider rows are locked again below
    // before a match is committed, so concurrent workers/requests cannot issue
    // duplicate waves or occupy the same Provider simultaneously.
    const ranked = await this.rankedProviders({ ...requestSnapshot, seekerId });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM service_requests WHERE id = ${requestId}::uuid FOR UPDATE`);
      const request = await tx.serviceRequest.findUnique({
        where: { id: requestId },
        select: { id: true, seekerId: true, skillCategory: true, matchingWave: true, matchingStartedAt: true, status: true },
      });
      if (!request || request.status !== "OPEN" || !request.seekerId) return { notified: 0, wave };
      // An immediate decline and the polling worker can race to advance the same
      // request. Only the first caller may commit a given wave.
      if (request.matchingWave >= wave) return { notified: 0, wave: request.matchingWave, alreadyDispatched: true };
      if (!force && Date.now() - request.matchingStartedAt.getTime() >= LIVE_MATCHING_WINDOW_MS) {
        await tx.serviceRequest.updateMany({ where: { id: requestId, status: "OPEN" }, data: { matchingNextAt: null } });
        return { notified: 0, wave, timedOut: true };
      }

      const alreadyMatched = await tx.requestMatch.findMany({
        where: { requestId },
        select: { providerId: true },
      });
      const seen = new Set(alreadyMatched.map((match) => match.providerId).filter((id): id is string => Boolean(id)));
      const compact = (value: string) => normalise(value).replace(/[^\p{L}\p{N}]+/gu, "");
      for (const provider of ranked) {
        if (seen.has(provider.userId)) continue;
        // Serialize all matching decisions for this Provider across different
        // service requests, not merely within this request's worker cycle.
        await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${provider.userId}::uuid FOR UPDATE`);

        const [approvedSkills, activeMatch, pendingOffer, activeJob] = await Promise.all([
          tx.providerSkill.findMany({
            where: { userId: provider.userId, status: "APPROVED", isPaused: false },
            select: { category: true },
          }),
          tx.requestMatch.findFirst({
            where: { providerId: provider.userId, status: { in: ["NOTIFIED", "RESPONDED"] }, request: { status: "OPEN" } },
            select: { id: true },
          }),
          tx.providerResponse.findFirst({
            // A legacy OFFERED row attached to a cancelled/closed request is
            // not an outstanding commitment and must not block new matching.
            where: {
              providerId: provider.userId,
              status: "OFFERED",
              request: { status: "OPEN" },
            },
            select: { id: true },
          }),
          tx.jobEngagement.findFirst({
            where: {
              providerId: provider.userId,
              status: { in: ["ASSESSMENT_PENDING", "ESTIMATE_SUBMITTED", "ESTIMATE_REJECTED", "ESTIMATE_APPROVED", "IN_PROGRESS", "COMPLETION_PENDING", "DISPUTED"] },
            },
            select: { id: true },
          }),
        ]);
        if (!approvedSkills.some((skill) => compact(skill.category) === compact(request.skillCategory))) continue;
        if (activeMatch || pendingOffer || activeJob) continue;

        await tx.requestMatch.create({
          data: { requestId, providerId: provider.userId, score: provider.score, wave, status: "NOTIFIED" },
        });
        await tx.appNotification.create({
          data: {
            userId: provider.userId,
            title: "Incoming AnySkill service request",
            body: "A new " + request.skillCategory + " request is available. Open AnySkill to review details or choose Accept / Decline.",
            data: { type: "MATCHED_REQUEST", requestId, wave },
          },
        });
        const now = new Date();
        await tx.serviceRequest.update({
          where: { id: requestId },
          data: {
            matchingWave: wave,
            matchingNextAt: new Date(now.getTime() + RESPONSE_WINDOW_MS),
            matchingExhaustedAt: null,
          },
        });
        return { notified: 1, wave, responseWindowSeconds: RESPONSE_WINDOW_MS / 1000 };
      }

      await tx.serviceRequest.update({
        where: { id: requestId },
        data: { matchingNextAt: null, matchingExhaustedAt: new Date() },
      });
      return { notified: 0, wave, exhausted: true };
    });
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
      where: { deliveryStatus: "PENDING" },
      take: 50,
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true, title: true, body: true, data: true, attempts: true },
    });

    for (const notification of pending) {
      const claim = await this.prisma.appNotification.updateMany({
        where: { id: notification.id, deliveryStatus: "PENDING" },
        data: { deliveryStatus: "SENDING", deliveryStartedAt: new Date() },
      });
      if (claim.count === 0) continue;

      try {
        const devices = await this.prisma.pushDevice.findMany({
          where: { userId: notification.userId },
          select: { id: true, platform: true, expoPushToken: true },
        });
        if (devices.length === 0) {
          await this.prisma.appNotification.update({
            where: { id: notification.id },
            data: { deliveryStatus: "IN_APP_ONLY" },
          });
          continue;
        }

        // Persist a separate delivery record before contacting Expo. skipDuplicates
        // makes worker restarts and overlapping instances safe for each notification/device pair.
        await this.prisma.notificationDeviceDelivery.createMany({
          data: devices.map((device) => ({
            notificationId: notification.id,
            pushDeviceId: device.id,
            status: "PENDING",
          })),
          skipDuplicates: true,
        });

        const deliveries = await this.prisma.notificationDeviceDelivery.findMany({
          where: {
            notificationId: notification.id,
            status: "PENDING",
            attempts: { lt: 5 },
            nextAttemptAt: { lte: new Date() },
          },
          include: { pushDevice: { select: { id: true, platform: true, expoPushToken: true } } },
        });

        let accepted = 0;
        let pendingRetry = 0;
        for (const delivery of deliveries) {
          const device = delivery.pushDevice;
          const deliveryClaim = await this.prisma.notificationDeviceDelivery.updateMany({
            where: { id: delivery.id, status: "PENDING", attempts: delivery.attempts },
            data: { status: "SENDING", attempts: { increment: 1 } },
          });
          if (deliveryClaim.count === 0) continue;

          try {
            const type = (notification.data as { type?: string } | null)?.type;
            const response = await fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              signal: AbortSignal.timeout(12_000),
              body: JSON.stringify({
                to: device.expoPushToken,
                title: notification.title,
                body: notification.body,
                data: notification.data ?? {},
                sound: "default",
                priority: "high",
                channelId: type === "MATCHED_REQUEST" ? "incoming_requests" : "default",
                ...(type === "MATCHED_REQUEST" ? { categoryId: "incoming_request" } : {}),
              }),
            });
            const responseText = await response.text();
            let payload: { data?: { status?: string; id?: string; message?: string; details?: { error?: string } }; errors?: Array<{ code?: string; message?: string }> } | null = null;
            try { payload = responseText ? JSON.parse(responseText) : null; } catch { /* handled below */ }

            if (!response.ok || !payload?.data) {
              const message = (payload?.errors ?? []).map((item) => [item.code, item.message].filter(Boolean).join(": ")).join("; ")
                || `Expo HTTP ${response.status}: ${responseText.slice(0, 500)}`;
              throw new Error(message);
            }
            if (payload.data.status !== "ok" || !payload.data.id) {
              const errorCode = payload.data.details?.error ?? "ExpoTicketRejected";
              const message = payload.data.message ?? "Expo did not accept this device notification.";
              if (errorCode === "DeviceNotRegistered") {
                // Mark the delivery before deleting the device: the device relation
                // cascades on delete, so deleting first would remove this delivery row.
                await this.prisma.notificationDeviceDelivery.update({
                  where: { id: delivery.id },
                  data: { status: "FAILED", lastError: errorCode },
                });
                await this.prisma.pushDevice.deleteMany({ where: { id: device.id } });
              } else {
                throw new Error(`${errorCode}: ${message}`);
              }
              continue;
            }

            await this.prisma.notificationDeviceDelivery.update({
              where: { id: delivery.id },
              data: {
                status: "ACCEPTED",
                expoTicketId: payload.data.id,
                acceptedAt: new Date(),
                lastError: null,
              },
            });
            accepted += 1;
          } catch (error) {
            const attempts = delivery.attempts + 1;
            const delayMs = Math.min(15 * 60_000, 15_000 * (2 ** Math.max(0, attempts - 1)));
            const permanent = /DeviceNotRegistered|InvalidCredentials|MessageTooBig|InvalidRecipients/i.test(String(error));
            await this.prisma.notificationDeviceDelivery.update({
              where: { id: delivery.id },
              data: {
                status: permanent || attempts >= 5 ? "FAILED" : "PENDING",
                nextAttemptAt: new Date(Date.now() + delayMs),
                lastError: String(error).slice(0, 1000),
              },
            });
            if (!permanent && attempts < 5) pendingRetry += 1;
            this.logger.warn(`Push notification ${notification.id} failed for device ${device.id} on attempt ${attempts}/5: ${String(error)}`);
          }
        }

        const states = await this.prisma.notificationDeviceDelivery.groupBy({
          by: ["status"],
          where: { notificationId: notification.id },
          _count: { _all: true },
        });
        const acceptedCount = states.find((item) => item.status === "ACCEPTED")?._count._all ?? 0;
        const pendingCount = states.find((item) => item.status === "PENDING" || item.status === "SENDING")?._count._all ?? 0;
        const failedCount = states.find((item) => item.status === "FAILED")?._count._all ?? 0;

        // SENT retains its existing meaning: Expo accepted at least one device ticket.
        // Per-device states retain the exact outcome for every registration.
        await this.prisma.appNotification.update({
          where: { id: notification.id },
          data: {
            deliveryStatus: pendingCount > 0 ? "PENDING" : acceptedCount > 0 ? "SENT" : failedCount > 0 ? "FAILED" : "IN_APP_ONLY",
            ...(acceptedCount > 0 ? { sentAt: new Date() } : {}),
          },
        });
        if (accepted > 0 || pendingRetry > 0) {
          this.logger.log(`Push notification ${notification.id}: ${acceptedCount} device(s) accepted, ${pendingCount} pending, ${failedCount} failed.`);
        }
      } catch (error) {
        const attempts = notification.attempts + 1;
        await this.prisma.appNotification.update({
          where: { id: notification.id },
          data: { deliveryStatus: attempts >= 5 ? "FAILED" : "PENDING" },
        });
        this.logger.warn(`Push notification ${notification.id} failed on attempt ${attempts}/5: ${String(error)}`);
      }
    }
  }

  private async pollExpoPushReceipts() {
    const accepted = await this.prisma.notificationDeviceDelivery.findMany({
      where: {
        status: "ACCEPTED",
        expoTicketId: { not: null },
        acceptedAt: { lte: new Date(Date.now() - 15 * 60_000) },
        receiptCheckedAt: null,
      },
      take: 100,
      orderBy: { acceptedAt: "asc" },
      include: { pushDevice: { select: { id: true } } },
    });
    for (let offset = 0; offset < accepted.length; offset += 300) {
      const batch = accepted.slice(offset, offset + 300);
      try {
        const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          signal: AbortSignal.timeout(12_000),
          body: JSON.stringify({ ids: batch.map((item) => item.expoTicketId) }),
        });
        if (!response.ok) throw new Error(`Expo receipts HTTP ${response.status}`);
        const payload = await response.json() as { data?: Record<string, { status?: string; message?: string; details?: { error?: string } }> };
        for (const delivery of batch) {
          const receipt = payload.data?.[delivery.expoTicketId!];
          if (!receipt) continue;
          const errorCode = receipt.details?.error;
          if (receipt.status === "ok") {
            await this.prisma.notificationDeviceDelivery.update({
              where: { id: delivery.id },
              data: { receiptCheckedAt: new Date(), lastError: null },
            });
          } else if (receipt.status === "error") {
            // Persist the receipt outcome before deleting a stale device registration.
            // The FK cascades its delivery row when the device is removed.
            await this.prisma.notificationDeviceDelivery.update({
              where: { id: delivery.id },
              data: {
                status: "FAILED",
                receiptCheckedAt: new Date(),
                lastError: `${errorCode ?? "ExpoReceiptError"}: ${receipt.message ?? "Push receipt reported an error"}`.slice(0, 1000),
              },
            });
            if (errorCode === "DeviceNotRegistered") {
              await this.prisma.pushDevice.deleteMany({ where: { id: delivery.pushDeviceId } });
            }
            this.logger.warn(`Expo receipt failed for notification ${delivery.notificationId}, device ${delivery.pushDeviceId}: ${errorCode ?? "ExpoReceiptError"}`);
          }
        }
      } catch (error) {
        // Leave receiptCheckedAt null so the next worker cycle safely retries receipt polling.
        this.logger.warn(`Expo push receipt polling failed: ${String(error)}`);
      }
    }
  }
}