import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { MarketplaceRoleStatus, Prisma, ProviderApplicationStatus, RegistrationMode } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

type SectionInput = { profile?: Record<string, unknown>; skills?: unknown[]; portfolio?: unknown[] };

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  private validatePayload(input: SectionInput) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BadRequestException("Onboarding data must be an object.");
    }
    const suppliedSections = Object.keys(input);
    if (suppliedSections.length === 0 || suppliedSections.some((key) => !["profile", "skills", "portfolio"].includes(key))) {
      throw new BadRequestException("Provide at least one valid onboarding section.");
    }
    const allowed = new Set([
      "accountType","marketplaceRole","marketplaceRoles","firstName","lastName","phone","phoneDialCode","profilePhotoUrl",
      "country","countryCode","province","city","suburb","address","houseNumber",
      "businessName","businessRegistrationNumber","businessType","businessEmail","businessPhone","businessCountry","businessProvince","businessCity","businessAddress",
      "contactFirstName","contactLastName","contactJobTitle","contactEmail","contactPhone",
    ]);
    if (input.profile) {
      if (typeof input.profile !== "object" || Array.isArray(input.profile)) throw new BadRequestException("Profile must be an object.");
      for (const [key,value] of Object.entries(input.profile)) {
        if (!allowed.has(key)) throw new BadRequestException(`Invalid profile field: ${key}`);
        if (key === "marketplaceRoles") {
          if (!Array.isArray(value) || value.length > 2 || value.some((role) => role !== "SEEKER" && role !== "PROVIDER") || new Set(value).size !== value.length) {
            throw new BadRequestException("Marketplace roles must be Skill Seeker, Skill Provider, or both.");
          }
          continue;
        }
        if (typeof value !== "string" || value.length > 1000 || value.trim() !== value) throw new BadRequestException(`Invalid profile field: ${key}`);
        if (["firstName", "lastName", "businessName", "businessType", "contactFirstName", "contactLastName", "contactJobTitle"].includes(key) && value.length > 120) throw new BadRequestException(`Invalid profile field: ${key}`);
        if (["phone", "phoneDialCode", "businessPhone", "contactPhone"].includes(key) && value && !/^[+0-9 ()-]{3,30}$/.test(value)) throw new BadRequestException(`Invalid phone number: ${key}`);
        if (["businessEmail", "contactEmail"].includes(key) && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new BadRequestException(`Invalid email address: ${key}`);
        if (key === "profilePhotoUrl" && value) this.assertHttpsUrl(value, "Profile photo");
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
      const skillFields = new Set(["category", "description", "yearsOfExperience", "licencesQualifications", "portfolio"]);
      if (Object.keys(item).some((key) => !skillFields.has(key))) throw new BadRequestException("Each skill contains an unsupported field.");
      if (typeof item.category !== "string" || item.category.trim().length < 2 || item.category.length > 100 || item.category.trim() !== item.category) throw new BadRequestException("Each skill needs a valid category.");
      if (item.description !== undefined && (typeof item.description !== "string" || item.description.length > 2000)) throw new BadRequestException("Skill descriptions must be 2,000 characters or fewer.");
      if (item.yearsOfExperience !== undefined && !(
        (typeof item.yearsOfExperience === "string" && item.yearsOfExperience.length <= 80) ||
        (typeof item.yearsOfExperience === "number" && Number.isFinite(item.yearsOfExperience) && item.yearsOfExperience >= 0 && item.yearsOfExperience <= 80)
      )) throw new BadRequestException("Years of experience must be a valid value between 0 and 80.");
      if (item.licencesQualifications !== undefined && (!Array.isArray(item.licencesQualifications) || item.licencesQualifications.length > 20)) throw new BadRequestException("Each skill can have up to 20 licences or qualifications.");
      for (const qualification of (item.licencesQualifications as unknown[] | undefined) ?? []) {
        const q = qualification as Record<string, unknown>;
        if (!q || typeof q !== "object" || Array.isArray(q) || Object.keys(q).some((key) => !["name", "attachmentUrl", "attachmentName"].includes(key)) || typeof q.name !== "string" || q.name.trim().length < 2 || q.name.length > 200 || typeof q.attachmentUrl !== "string" || q.attachmentUrl.length > 2000) throw new BadRequestException("Each qualification needs a name and attachment reference.");
        this.assertAssetId(q.attachmentUrl, "Qualification attachment");
        if (q.attachmentName !== undefined && (typeof q.attachmentName !== "string" || q.attachmentName.length > 255)) throw new BadRequestException("Qualification attachment names must be 255 characters or fewer.");
      }
      if (item.portfolio !== undefined && (!Array.isArray(item.portfolio) || item.portfolio.length > 30)) throw new BadRequestException("Each skill can have up to 30 portfolio items.");
      for (const portfolioItem of (item.portfolio as unknown[] | undefined) ?? []) {
        const work = portfolioItem as Record<string, unknown>;
        if (!work || typeof work !== "object" || Array.isArray(work) || Object.keys(work).some((key) => !["title", "description", "linkTitle", "linkUrl", "links", "imageUrls"].includes(key))) throw new BadRequestException("Each portfolio item must be an object containing supported fields.");
        if (work.title !== undefined && (typeof work.title !== "string" || work.title.length > 200)) throw new BadRequestException("Portfolio titles must be 200 characters or fewer.");
        if (work.description !== undefined && (typeof work.description !== "string" || work.description.length > 2000)) throw new BadRequestException("Portfolio descriptions must be 2,000 characters or fewer.");
        if (work.linkTitle !== undefined && (typeof work.linkTitle !== "string" || work.linkTitle.length > 200)) throw new BadRequestException("Portfolio link titles must be 200 characters or fewer.");
        if (work.linkUrl !== undefined && (typeof work.linkUrl !== "string" || work.linkUrl.length > 2000)) throw new BadRequestException("Portfolio links must be valid text URLs.");
        if (work.linkUrl !== undefined && work.linkUrl !== "") this.assertHttpsUrl(work.linkUrl as string, "Portfolio link");
        for (const key of ["links", "imageUrls"]) {
          if (work[key] !== undefined && (!Array.isArray(work[key]) || (work[key] as unknown[]).length > 20 || (work[key] as unknown[]).some((url) => typeof url !== "string" || url.length > 2000))) throw new BadRequestException(`Portfolio ${key} must be a list of valid references.`);
          for (const url of (work[key] as string[] | undefined) ?? []) {
            if (key === "imageUrls") this.assertAssetId(url, "Portfolio image");
            else this.assertHttpsUrl(url, "Portfolio link");
          }
        }
      }
    }
    const normalizedSkills = (input.skills ?? []).map((skill) => String((skill as Record<string, unknown>).category ?? "").trim().toLocaleLowerCase("en-ZA")).filter(Boolean);
    if (new Set(normalizedSkills).size !== normalizedSkills.length) throw new BadRequestException("Duplicate skills are not allowed. Keep one entry for each skill.");
    for (const item of input.portfolio ?? []) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new BadRequestException("Each portfolio item must be an object.");
      const work = item as Record<string, unknown>;
      if (Object.keys(work).some((key) => !["title", "description", "linkTitle", "linkUrl", "links", "imageUrls"].includes(key)) || typeof work.title !== "string" || !work.title.trim() || work.title.length > 200) throw new BadRequestException("Each portfolio item needs a valid title.");
      if (work.description !== undefined && (typeof work.description !== "string" || work.description.length > 2000)) throw new BadRequestException("Portfolio descriptions must be 2,000 characters or fewer.");
      if (work.linkUrl !== undefined && (typeof work.linkUrl !== "string" || work.linkUrl.length > 2000)) throw new BadRequestException("Portfolio links must be valid URLs.");
      if (typeof work.linkUrl === "string" && work.linkUrl) this.assertHttpsUrl(work.linkUrl, "Portfolio link");
      for (const key of ["links", "imageUrls"]) {
        if (work[key] !== undefined && (!Array.isArray(work[key]) || (work[key] as unknown[]).length > 20 || (work[key] as unknown[]).some((url) => typeof url !== "string" || url.length > 2000))) throw new BadRequestException(`Portfolio ${key} must be a list of valid references.`);
        for (const url of (work[key] as string[] | undefined) ?? []) {
          if (key === "imageUrls") this.assertAssetId(url, "Portfolio image");
          else this.assertHttpsUrl(url, "Portfolio link");
        }
      }
    }
  }

  private assertAssetId(value: string, label: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${label} must reference a valid uploaded asset.`);
    }
  }

  private async assertOwnedReadyAssets(userId: string, input: SectionInput): Promise<void> {
    const expected = new Map<string, string>();
    for (const skill of input.skills ?? []) {
      const item = skill as Record<string, unknown>;
      for (const qualification of (item.licencesQualifications as Array<Record<string, unknown>> | undefined) ?? []) {
        if (typeof qualification.attachmentUrl === "string") expected.set(qualification.attachmentUrl, "PROVIDER_QUALIFICATION");
      }
      for (const portfolioItem of (item.portfolio as Array<Record<string, unknown>> | undefined) ?? []) {
        for (const assetId of (portfolioItem.imageUrls as string[] | undefined) ?? []) expected.set(assetId, "PROVIDER_PORTFOLIO_IMAGE");
      }
    }
    for (const portfolioItem of input.portfolio ?? []) {
      const item = portfolioItem as Record<string, unknown>;
      for (const assetId of (item.imageUrls as string[] | undefined) ?? []) expected.set(assetId, "PROVIDER_PORTFOLIO_IMAGE");
    }
    if (expected.size === 0) return;
    const assets = await this.prisma.mediaAsset.findMany({
      where: { id: { in: [...expected.keys()] }, userId, status: "READY" },
      select: { id: true, purpose: true },
    });
    const found = new Map(assets.map((asset) => [asset.id, asset.purpose]));
    for (const [assetId, purpose] of expected) {
      if (found.get(assetId) !== purpose) {
        throw new BadRequestException("One or more onboarding attachments are unavailable, not ready, or do not belong to this account. Upload them again.");
      }
    }
  }

  private assertHttpsUrl(value: string, label: string): void {
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new BadRequestException(`${label} must be a valid HTTPS URL.`); }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || /^127\./.test(host) || host === "::1" || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
      throw new BadRequestException(`${label} must use a public HTTPS address.`);
    }
  }

  private completion(data: { profile: any; skills: any; portfolio: any }) {
    const p = data.profile && typeof data.profile === "object" ? data.profile : {};
    const skills = Array.isArray(data.skills) ? data.skills : [];
    const portfolio = Array.isArray(data.portfolio) ? data.portfolio : [];
    const roles = Array.isArray(p.marketplaceRoles) ? p.marketplaceRoles : p.marketplaceRole ? [p.marketplaceRole] : [];
    const hasRole = roles.some((role: unknown) => role === "SEEKER" || role === "PROVIDER");
    const value = (item: unknown) => typeof item === "string" ? item.trim() : "";
    const validEmail = (item: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value(item));
    const validPhone = (...parts: unknown[]) => {
      const digits = parts.map(value).join("").replace(/\D/g, "");
      return digits.length >= 7 && digits.length <= 15;
    };
    const individualComplete = Boolean(
      value(p.firstName) && value(p.lastName) &&
      validPhone(p.phoneDialCode, p.phone),
    );
    const businessComplete = Boolean(
      value(p.businessName) && value(p.businessType) &&
      validEmail(p.businessEmail) && validPhone(p.businessPhone) &&
      value(p.businessCountry) && value(p.businessProvince) &&
      value(p.businessAddress) && value(p.contactFirstName) &&
      value(p.contactLastName) && value(p.contactJobTitle) &&
      validEmail(p.contactEmail) && validPhone(p.contactPhone),
    );
    const sections = {
      profile: Boolean(p.accountType && hasRole && (p.accountType === "BUSINESS" ? businessComplete : individualComplete)),
      // One valid skill category satisfies the agreed minimum. A description
      // is useful detail, but it is not a separate completion requirement.
      skills: skills.some((s) => typeof s?.category === "string" && s.category.trim()),
      portfolio: skills.some((skill) => Array.isArray(skill?.portfolio) && skill.portfolio.some((item: any) => Boolean(item?.linkUrl?.trim?.() || item?.links?.length || item?.imageUrls?.length || item?.title?.trim?.()))) || portfolio.some((item) => typeof item?.title === "string" && item.title.trim()),
    };
    const completed = Object.values(sections).filter(Boolean).length;
    return { percentage: Math.round((completed / 3) * 100), sections };
  }

  async get(userId: string) {
    const [draft, providerApplication, providerSkills] = await Promise.all([
      this.prisma.onboardingDraft.findUnique({ where: { userId } }),
      this.prisma.providerRoleApplication.findUnique({ where: { userId }, select: { status: true } }),
      this.prisma.providerSkill.findMany({
        where: { userId },
        select: { category: true, status: true, decisionReason: true, submittedAt: true, reviewedAt: true },
        orderBy: [{ category: "asc" }],
      }),
    ]);
    const data = { profile: draft?.profile ?? {}, skills: draft?.skills ?? [], portfolio: draft?.portfolio ?? [] };
    return {
      ...data,
      ...this.completion(data),
      providerApplicationStatus: providerApplication?.status ?? null,
      skillReviewStatuses: providerSkills.map((skill) => ({
        category: skill.category,
        status: skill.status,
        decisionReason: skill.decisionReason,
        submittedAt: skill.submittedAt,
        reviewedAt: skill.reviewedAt,
      })),
      submittedAt: draft?.submittedAt ?? null,
      updatedAt: draft?.updatedAt ?? null,
    };
  }

  async save(userId: string, input: SectionInput) {
    this.validatePayload(input);
    await this.assertOwnedReadyAssets(userId, input);
    const data = {
      ...(input.profile !== undefined ? { profile: input.profile as Prisma.InputJsonValue } : {}),
      ...(input.skills !== undefined ? { skills: input.skills as Prisma.InputJsonValue } : {}),
      ...(input.portfolio !== undefined ? { portfolio: input.portfolio as Prisma.InputJsonValue } : {}),
      submittedAt: null,
    };
    await this.prisma.$transaction(async (tx) => {
      // Draft edits and submission share the account lifecycle lock. This makes
      // a save atomic with respect to a simultaneous submit/review decision.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('provider-eligibility'), hashtext(${userId}))`;
      await tx.onboardingDraft.upsert({
        where: { userId },
        create: { userId, profile: (input.profile ?? {}) as Prisma.InputJsonValue, skills: (input.skills ?? []) as Prisma.InputJsonValue, portfolio: (input.portfolio ?? []) as Prisma.InputJsonValue },
        update: data,
      });
    });

    // Saving a draft must not create review-queue records. ProviderSkill
    // rows are created or re-submitted only after the user explicitly submits.
    return this.get(userId);
  }

  async submit(userId: string) {
    const [onboarding, user] = await Promise.all([
      this.get(userId),
      this.prisma.user.findUnique({ where: { id: userId }, select: { initialMode: true } }),
    ]);
    await this.assertOwnedReadyAssets(userId, {
      profile: (onboarding.profile ?? {}) as Record<string, unknown>,
      skills: (Array.isArray(onboarding.skills) ? onboarding.skills : []) as unknown[],
      portfolio: (Array.isArray(onboarding.portfolio) ? onboarding.portfolio : []) as unknown[],
    });
    const profile =
      onboarding.profile && typeof onboarding.profile === "object" && !Array.isArray(onboarding.profile)
        ? (onboarding.profile as Record<string, unknown>)
        : {};
    const roles: unknown[] = Array.isArray(profile.marketplaceRoles)
      ? profile.marketplaceRoles
      : typeof profile.marketplaceRole === "string" ? [profile.marketplaceRole] : [];
    const providerRequired = user?.initialMode === "PROVIDER" || roles.includes("PROVIDER");
    const missingSections = [
      ...(!onboarding.sections.profile ? ["Profile (complete contact details)"] : []),
      ...(providerRequired && !onboarding.sections.skills ? ["Skills (at least one valid skill)"] : []),
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
    const skillDetails: Prisma.JsonObject[] = Array.isArray(onboarding.skills)
      ? onboarding.skills.filter((item): item is Prisma.JsonObject => item !== null && typeof item === "object" && !Array.isArray(item))
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
      // Serialize onboarding submission with Provider applications and identity
      // review decisions. This prevents duplicate review notifications and stale
      // role state from winning when two lifecycle actions race across replicas.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('provider-eligibility'), hashtext(${userId}))`;
      const currentDraft = await tx.onboardingDraft.findUnique({
        where: { userId },
        select: { updatedAt: true },
      });
      if (!currentDraft || currentDraft.updatedAt.getTime() !== onboarding.updatedAt?.getTime()) {
        throw new ConflictException("Your onboarding details changed while you were submitting. Refresh your profile and submit again.");
      }
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
        // Persist each skill independently. Draft saves never enter the
        // review queue; explicit submission creates new reviews and a changed
        // or rejected skill is returned to PENDING without disturbing other
        // approved skills.
        for (const skill of skillDetails) {
          const category = typeof skill.category === "string"
            ? skill.category.trim().toLocaleLowerCase("en-ZA")
            : "";
          if (!category) continue;
          const existingSkill = await tx.providerSkill.findUnique({
            where: { userId_category: { userId, category } },
            select: { status: true, details: true },
          });
          if (!existingSkill) {
            await tx.providerSkill.create({
              data: { userId, category, details: skill as Prisma.InputJsonValue },
            });
            continue;
          }
          const detailsChanged = JSON.stringify(existingSkill.details) !== JSON.stringify(skill);
          if (existingSkill.status === "REJECTED" || (existingSkill.status === "APPROVED" && detailsChanged)) {
            await tx.providerSkill.update({
              where: { userId_category: { userId, category } },
              data: {
                status: "PENDING",
                details: skill as Prisma.InputJsonValue,
                decisionReason: null,
                reviewerId: null,
                reviewedAt: null,
                submittedAt,
              },
            });
          } else if (existingSkill.status === "PENDING") {
            await tx.providerSkill.update({
              where: { userId_category: { userId, category } },
              data: { details: skill as Prisma.InputJsonValue, submittedAt },
            });
          }
        }

        if (!publicName || skills.length === 0) {
          throw new BadRequestException("Provider applications require a public name and at least one skill.");
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
          const applicationData = JSON.parse(JSON.stringify({
            publicName: publicName.trim(),
            skills: [...new Set(skills.map((value) => value.toLocaleLowerCase("en-ZA")))],
            skillDetails,
            portfolio: skillDetails.flatMap((skill) => Array.isArray(skill.portfolio) ? skill.portfolio : []).filter((item) => item && typeof item === "object"),
            qualifications: skillDetails.flatMap((skill) => Array.isArray(skill.licencesQualifications) ? skill.licencesQualifications : []),
          })) as Prisma.InputJsonObject;
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
