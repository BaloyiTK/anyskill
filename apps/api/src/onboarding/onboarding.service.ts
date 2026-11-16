import { BadRequestException, Injectable } from "@nestjs/common";
import { MarketplaceRoleStatus, Prisma, ProviderApplicationStatus, RegistrationMode } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

type SectionInput = { profile?: Record<string, unknown>; skills?: unknown[]; portfolio?: unknown[] };

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  private validatePayload(input: SectionInput) {
    const allowed = new Set([
      "accountType","marketplaceRole","marketplaceRoles","firstName","lastName","phone","phoneDialCode","profilePhotoUrl",
      "country","countryCode","province","city","suburb","address","houseNumber",
      "businessName","businessRegistrationNumber","businessType","businessEmail","businessPhone","businessCountry","businessProvince","businessCity","businessAddress",
      "contactFirstName","contactLastName","contactJobTitle","contactEmail","contactPhone",
    ]);
    if (input.profile) {
      for (const [key,value] of Object.entries(input.profile)) {
        if (!allowed.has(key)) throw new BadRequestException(`Invalid profile field: ${key}`);
        if (key === "marketplaceRoles") {
          if (!Array.isArray(value) || value.length > 2 || value.some((role) => role !== "SEEKER" && role !== "PROVIDER") || new Set(value).size !== value.length) {
            throw new BadRequestException("Marketplace roles must be Skill Seeker, Skill Provider, or both.");
          }
          continue;
        }
        if (typeof value !== "string" || value.length > 1000) throw new BadRequestException(`Invalid profile field: ${key}`);
        if (key === "accountType" && !["INDIVIDUAL","BUSINESS"].includes(value)) {
          throw new BadRequestException("Account type must be INDIVIDUAL or BUSINESS.");
        }
        if (key === "marketplaceRole" && !["SEEKER","PROVIDER"].includes(value)) {
          throw new BadRequestException("Marketplace role must be SEEKER or PROVIDER.");
        }
      }
    }
    if (input.skills && (!Array.isArray(input.skills) || input.skills.length > 30)) throw new BadRequestException("Skills must be an array with no more than 30 entries.");
    if (input.portfolio && (!Array.isArray(input.portfolio) || input.portfolio.length > 30)) throw new BadRequestException("Portfolio must be an array with no more than 30 entries.");
    if (JSON.stringify(input).length > 50_000) throw new BadRequestException("Onboarding data is too large.");
    for (const skill of input.skills ?? []) {
      if (!skill || typeof skill !== "object" || Array.isArray(skill)) throw new BadRequestException("Each skill must be an object.");
      const item = skill as Record<string, unknown>;
      if (typeof item.category !== "string" || item.category.trim().length < 2 || item.category.length > 100) throw new BadRequestException("Each skill needs a valid category.");
      if (item.description !== undefined && (typeof item.description !== "string" || item.description.length > 2000)) throw new BadRequestException("Skill descriptions must be 2,000 characters or fewer.");
      if (item.supportingDocuments !== undefined && !Array.isArray(item.supportingDocuments)) throw new BadRequestException("Supporting documents must be attached to their relevant skill.");
    }
    for (const item of input.portfolio ?? []) {
      if (!item || typeof item !== "object" || Array.isArray(item) || typeof (item as Record<string, unknown>).title !== "string") {
        throw new BadRequestException("Each portfolio item needs a title.");
      }
    }
  }

  private completion(data: { profile: any; skills: any; portfolio: any }) {
    const p = data.profile && typeof data.profile === "object" ? data.profile : {};
    const skills = Array.isArray(data.skills) ? data.skills : [];
    const portfolio = Array.isArray(data.portfolio) ? data.portfolio : [];
    const roles = Array.isArray(p.marketplaceRoles) ? p.marketplaceRoles : p.marketplaceRole ? [p.marketplaceRole] : [];
    const hasRole = roles.some((role: unknown) => role === "SEEKER" || role === "PROVIDER");
    const individualComplete = Boolean(p.firstName?.trim() && p.lastName?.trim() && p.phone?.trim());
    const businessComplete = Boolean(
      p.businessName?.trim() && p.businessType?.trim() && p.businessEmail?.trim() && p.businessPhone?.trim() &&
      p.businessCountry?.trim() && p.businessProvince?.trim() && p.businessAddress?.trim() &&
      p.contactFirstName?.trim() && p.contactLastName?.trim() && p.contactJobTitle?.trim() && p.contactEmail?.trim() && p.contactPhone?.trim()
    );
    const sections = {
      profile: Boolean(p.accountType && hasRole && (p.accountType === "BUSINESS" ? businessComplete : individualComplete)),
      // One valid skill category satisfies the agreed minimum. A description
      // is useful detail, but it is not a separate completion requirement.
      skills: skills.some((s) => typeof s?.category === "string" && s.category.trim()),
      portfolio: portfolio.some((item) => typeof item?.title === "string" && item.title.trim()),
    };
    const completed = Object.values(sections).filter(Boolean).length;
    return { percentage: Math.round((completed / 3) * 100), sections };
  }

  async get(userId: string) {
    const draft = await this.prisma.onboardingDraft.findUnique({ where: { userId } });
    const data = { profile: draft?.profile ?? {}, skills: draft?.skills ?? [], portfolio: draft?.portfolio ?? [] };
    return { ...data, ...this.completion(data), submittedAt: draft?.submittedAt ?? null, updatedAt: draft?.updatedAt ?? null };
  }

  async save(userId: string, input: SectionInput) {
    this.validatePayload(input);
    const data = {
      ...(input.profile !== undefined ? { profile: input.profile as Prisma.InputJsonValue } : {}),
      ...(input.skills !== undefined ? { skills: input.skills as Prisma.InputJsonValue } : {}),
      ...(input.portfolio !== undefined ? { portfolio: input.portfolio as Prisma.InputJsonValue } : {}),
      submittedAt: null,
    };
    await this.prisma.onboardingDraft.upsert({
      where: { userId },
      create: { userId, profile: (input.profile ?? {}) as Prisma.InputJsonValue, skills: (input.skills ?? []) as Prisma.InputJsonValue, portfolio: (input.portfolio ?? []) as Prisma.InputJsonValue },
      update: data,
    });
    return this.get(userId);
  }

  async submit(userId: string) {
    const [onboarding, user] = await Promise.all([
      this.get(userId),
      this.prisma.user.findUnique({ where: { id: userId }, select: { initialMode: true } }),
    ]);
    const profile =
      onboarding.profile && typeof onboarding.profile === "object" && !Array.isArray(onboarding.profile)
        ? (onboarding.profile as Record<string, unknown>)
        : {};
    const roles: unknown[] = Array.isArray(profile.marketplaceRoles)
      ? profile.marketplaceRoles
      : typeof profile.marketplaceRole === "string" ? [profile.marketplaceRole] : [];
    const providerRequired = user?.initialMode === "PROVIDER" || roles.includes("PROVIDER");
    const missingSections = [
      ...(!onboarding.sections.profile ? ["Profile"] : []),
      ...(providerRequired && !onboarding.sections.skills ? ["Skills"] : []),
      ...(providerRequired && !onboarding.sections.portfolio ? ["Portfolio"] : []),
    ];
    if (missingSections.length) {
      throw new BadRequestException(
        `Profile not complete yet. Complete the following section${missingSections.length > 1 ? "s" : ""}: ${missingSections.join(", ")}.`,
      );
    }

    // The initial registration mode is always a requested role, even when
    // older clients have not yet persisted marketplaceRoles in the profile.
    const requestedRoles = new Set<string>(
      roles.filter((role): role is string => role === "SEEKER" || role === "PROVIDER"),
    );
    if (user?.initialMode === "SEEKER" || user?.initialMode === "PROVIDER") {
      requestedRoles.add(user.initialMode);
    }
    if (requestedRoles.size === 0) {
      throw new BadRequestException("Select at least one marketplace role before submitting.");
    }

    const profileData = profile as Record<string, unknown>;
    const skills = Array.isArray(onboarding.skills)
      ? onboarding.skills
          .map((item: any) => typeof item?.category === "string" ? item.category.trim() : "")
          .filter(Boolean)
      : [];
    const portfolio = Array.isArray(onboarding.portfolio)
      ? onboarding.portfolio
          .map((item: any) => typeof item?.title === "string" ? item.title.trim() : "")
          .filter(Boolean)
      : [];
    const publicName = [
      profileData.businessName,
      [profileData.firstName, profileData.lastName].filter((value) => typeof value === "string" && value.trim()).join(" "),
    ].find((value) => typeof value === "string" && value.trim()) as string | undefined;

    // Submission must update the role lifecycle as well as the onboarding
    // draft. Provider access remains pending until a reviewer approves it.
    const submittedAt = new Date();
    const wantsProvider = requestedRoles.has("PROVIDER");
    await this.prisma.$transaction(async (tx) => {
      await tx.onboardingDraft.update({
        where: { userId },
        data: { submittedAt },
      });

      const currentUser = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          seekerRoleStatus: true,
          providerRoleStatus: true,
        },
      });

      const wantsSeeker = requestedRoles.has("SEEKER");
      let seekerRoleStatus = currentUser.seekerRoleStatus;
      let providerRoleStatus = currentUser.providerRoleStatus;

      if (wantsSeeker && seekerRoleStatus !== MarketplaceRoleStatus.SUSPENDED) {
        seekerRoleStatus = MarketplaceRoleStatus.ACTIVE;
      }

      if (wantsProvider) {
        if (!publicName || skills.length === 0 || portfolio.length === 0) {
          throw new BadRequestException("Provider applications require a public name, at least one skill and at least one portfolio item.");
        }

        const existingApplication = await tx.providerRoleApplication.findUnique({
          where: { userId },
          select: { status: true },
        });
        const applicationAlreadyInReview =
          existingApplication?.status === ProviderApplicationStatus.PENDING ||
          existingApplication?.status === ProviderApplicationStatus.UNDER_REVIEW;

        if (
          providerRoleStatus !== MarketplaceRoleStatus.ACTIVE &&
          providerRoleStatus !== MarketplaceRoleStatus.SUSPENDED &&
          !applicationAlreadyInReview
        ) {
          const applicationData = {
            publicName: publicName.trim(),
            skills: [...new Set(skills.map((value) => value.toLocaleLowerCase("en-ZA")))],
            portfolio,
            qualifications: [],
          };
          await tx.providerRoleApplication.upsert({
            where: { userId },
            create: {
              userId,
              status: ProviderApplicationStatus.PENDING,
              applicationData,
              submittedAt,
            },
            update: {
              status: ProviderApplicationStatus.PENDING,
              applicationData,
              submittedAt,
              reviewedAt: null,
              reviewerId: null,
              decisionReason: null,
            },
          });
          providerRoleStatus = MarketplaceRoleStatus.PENDING;
          await tx.appNotification.create({
            data: {
              userId,
              title: "Provider application submitted",
              body: "Your Provider application is awaiting manual review. Your existing marketplace access remains available.",
              data: { type: "PROVIDER_ROLE_APPLICATION_SUBMITTED" },
            },
          });
        }
      }

      const activeMarketplaceMode =
        seekerRoleStatus === MarketplaceRoleStatus.ACTIVE
          ? RegistrationMode.SEEKER
          : providerRoleStatus === MarketplaceRoleStatus.ACTIVE
            ? RegistrationMode.PROVIDER
            : null;

      await tx.user.update({
        where: { id: userId },
        data: {
          seekerRoleStatus,
          providerRoleStatus,
          activeMarketplaceMode,
        },
      });
    });

    return {
      submittedAt,
      message: wantsProvider
        ? "Your profile has been submitted. Your Provider application is awaiting review."
        : "Your profile has been submitted successfully.",
    };
  }
}
