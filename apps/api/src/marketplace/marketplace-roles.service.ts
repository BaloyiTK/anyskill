import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { IdentityVerificationStatus, MarketplaceRoleStatus, ProviderApplicationStatus, RegistrationMode, StaffRole, VerificationCaseStatus } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { MediaService } from "./media.service";

export type StaffMemberUpdate = { role?: StaffRole; isActive?: boolean };

export type ProviderApplicationInput = {
  publicName: string;
  skills: string[];
  portfolio: string[];
  qualifications?: string[];
};

@Injectable()
export class MarketplaceRolesService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService) {}

  async getRoles(userId: string) {
    const [user, application] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          seekerRoleStatus: true,
          providerRoleStatus: true,
          activeMarketplaceMode: true,
        },
      }),
      this.prisma.providerRoleApplication.findUnique({
        where: { userId },
        select: { status: true, submittedAt: true, reviewedAt: true, decisionReason: true },
      }),
    ]);
    return {
      seekerStatus: user.seekerRoleStatus,
      providerStatus: user.providerRoleStatus,
      activeMode: user.activeMarketplaceMode,
      providerApplication: application,
    };
  }

  async switchMode(userId: string, mode: RegistrationMode) {
    const roleField = mode === "SEEKER" ? "seekerRoleStatus" : "providerRoleStatus";
    const updated = await this.prisma.user.updateMany({
      where: { id: userId, [roleField]: MarketplaceRoleStatus.ACTIVE },
      data: { activeMarketplaceMode: mode },
    });
    if (updated.count !== 1) {
      throw new ForbiddenException({
        code: "MARKETPLACE_ROLE_NOT_ACTIVE",
        role: mode,
        message: "You can switch only to a marketplace role that has been activated for your account.",
      });
    }
    return this.getRoles(userId);
  }

  async activateSeeker(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { seekerRoleStatus: true },
    });
    if (user.seekerRoleStatus === MarketplaceRoleStatus.SUSPENDED) {
      throw new ForbiddenException("Seeker access is suspended. Contact AnySkill support.");
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        seekerRoleStatus: MarketplaceRoleStatus.ACTIVE,
        activeMarketplaceMode: RegistrationMode.SEEKER,
      },
    });
    return this.getRoles(userId);
  }

  async submitProviderApplication(userId: string, input: ProviderApplicationInput) {
    const applicationData = {
      publicName: input.publicName.trim(),
      skills: [...new Set(input.skills.map((value) => value.trim().toLocaleLowerCase("en-ZA")).filter(Boolean))],
      portfolio: input.portfolio.map((value) => value.trim()).filter(Boolean),
      qualifications: (input.qualifications ?? []).map((value) => value.trim()).filter(Boolean),
    };
    if (!applicationData.publicName || applicationData.skills.length === 0 || applicationData.portfolio.length === 0) {
      throw new ConflictException("Add your public name, at least one skill and at least one portfolio item before submitting.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('provider-eligibility'), hashtext(${userId}))`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { providerRoleStatus: true },
      });
      if (user.providerRoleStatus === MarketplaceRoleStatus.ACTIVE) {
        throw new ConflictException("Your Provider role is already active.");
      }
      if (user.providerRoleStatus === MarketplaceRoleStatus.PENDING) {
        throw new ConflictException("Your Provider application is already awaiting review.");
      }
      if (user.providerRoleStatus === MarketplaceRoleStatus.SUSPENDED) {
        throw new ForbiddenException("Provider access is suspended. Contact AnySkill support.");
      }

      await tx.providerRoleApplication.upsert({
        where: { userId },
        create: { userId, status: ProviderApplicationStatus.PENDING, applicationData },
        update: {
          status: ProviderApplicationStatus.PENDING,
          applicationData,
          submittedAt: new Date(),
          reviewedAt: null,
          reviewerId: null,
          decisionReason: null,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { providerRoleStatus: MarketplaceRoleStatus.PENDING },
      });
      await tx.appNotification.create({
        data: {
          userId,
          title: "Provider application submitted",
          body: "Your Provider application is awaiting manual review. Your existing marketplace access remains available.",
          data: { type: "PROVIDER_ROLE_APPLICATION_SUBMITTED" },
        },
      });
    });

    return this.getRoles(userId);
  }

  async listStaffMembers() {
    return this.prisma.staffMembership.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, role: true, isActive: true, createdAt: true,
        user: { select: { id: true, email: true, createdAt: true } },
      },
    });
  }

  async createStaffMember(actorId: string, email: string, role: StaffRole) {
    if (role === StaffRole.SUPER_ADMIN) {
      throw new ForbiddenException("The single Super Administrator account is provisioned separately and cannot be created from staff management.");
    }
    const normalizedEmail = email.trim().toLocaleLowerCase("en-ZA");
    const target = await this.prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true, email: true } });
    if (!target) throw new NotFoundException("No AnySkill account exists with that email. Ask the person to register first.");
    if (target.id === actorId) throw new ForbiddenException("You cannot assign staff access to yourself.");
    const existing = await this.prisma.staffMembership.findUnique({ where: { userId: target.id } });
    if (existing) throw new ConflictException("This user already has a staff membership. Update their existing membership instead.");
    const created = await this.prisma.$transaction(async (tx) => {
      const membership = await tx.staffMembership.create({ data: { userId: target.id, role, isActive: true }, select: { id: true, role: true, isActive: true, createdAt: true } });
      await tx.staffAuditLog.create({ data: { actorId, targetUserId: target.id, action: "STAFF_MEMBER_CREATED", metadata: { email: target.email, role } } });
      return membership;
    });
    return { ...created, user: target };
  }

  async updateStaffMember(actorId: string, targetUserId: string, input: StaffMemberUpdate) {
    if (targetUserId === actorId && (input.isActive === false || (input.role && input.role !== StaffRole.SUPER_ADMIN))) {
      throw new ForbiddenException("You cannot remove or change your own Super Administrator access.");
    }
    if (input.role === StaffRole.SUPER_ADMIN) {
      throw new ForbiddenException("The Super Administrator role is reserved for the single bootstrap account.");
    }
    const existing = await this.prisma.staffMembership.findUnique({ where: { userId: targetUserId }, select: { id: true, role: true, isActive: true } });
    if (!existing) throw new NotFoundException("Staff membership not found.");
    if (existing.role === StaffRole.SUPER_ADMIN) throw new ForbiddenException("The Super Administrator membership cannot be changed here.");
    const updated = await this.prisma.$transaction(async (tx) => {
      const membership = await tx.staffMembership.update({
        where: { userId: targetUserId },
        data: { ...(input.role ? { role: input.role } : {}), ...(typeof input.isActive === "boolean" ? { isActive: input.isActive } : {}) },
        select: { id: true, role: true, isActive: true, createdAt: true },
      });
      await tx.staffAuditLog.create({ data: { actorId, targetUserId, action: "STAFF_MEMBER_UPDATED", metadata: { before: existing, after: { role: membership.role, isActive: membership.isActive } } } });
      return membership;
    });
    return { ...updated, user: await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, email: true, createdAt: true } }) };
  }

  async listAdminAccounts() {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true, email: true, initialMode: true, seekerRoleStatus: true,
        providerRoleStatus: true, identityVerification: true,
        onboardingDraft: { select: { profile: true } },
        identityCases: { orderBy: { submittedAt: "desc" }, take: 1,
          select: { status: true, decisionReason: true, reviewedAt: true } },
        providerSkills: { orderBy: { category: "asc" },
          select: { id: true, category: true, status: true, decisionReason: true, submittedAt: true, reviewedAt: true } },
      },
    });
    return users.map((user) => {
      const modes: string[] = [];
      const profile = user.onboardingDraft?.profile && typeof user.onboardingDraft.profile === "object" && !Array.isArray(user.onboardingDraft.profile)
        ? user.onboardingDraft.profile as Record<string, unknown> : {};
      const requestedModes = Array.isArray(profile.marketplaceRoles)
        ? profile.marketplaceRoles
        : typeof profile.marketplaceRole === "string" ? [profile.marketplaceRole] : [];
      if (user.initialMode === RegistrationMode.SEEKER || requestedModes.includes("SEEKER")) modes.push("Seeker");
      if (user.initialMode === RegistrationMode.PROVIDER || requestedModes.includes("PROVIDER")) modes.push("Provider");
      const latestIdentity = user.identityCases[0] ?? null;
      return {
        id: user.id,
        email: user.email,
        mode: modes,
        identity: {
          status: user.identityVerification === IdentityVerificationStatus.FAILED ? "REJECTED" : user.identityVerification,
          reason: latestIdentity?.decisionReason ?? null,
          reviewedAt: latestIdentity?.reviewedAt ?? null,
        },
        skills: user.providerSkills.map((skill) => ({
          id: skill.id, name: skill.category, status: skill.status,
          reason: skill.decisionReason, submittedAt: skill.submittedAt, reviewedAt: skill.reviewedAt,
        })),
      };
    });
  }

  async listIdentityReviews() {
    const cases = await this.prisma.identityVerificationCase.findMany({
      where: { status: { in: [VerificationCaseStatus.SUBMITTED, VerificationCaseStatus.UNDER_REVIEW] } },
      orderBy: { submittedAt: "asc" },
      take: 200,
      select: {
        id: true, status: true, submittedAt: true,
        user: { select: { id: true, email: true, identityVerification: true } },
      },
    });
    return Promise.all(cases.map(async (item) => {
      const previews = await Promise.all(
        (["ID_DOCUMENT_FRONT", "ID_DOCUMENT_BACK", "ID_BOOK_PAGE_1", "ID_BOOK_PAGE_2", "ID_SELFIE"] as const)
          .map(async (purpose) => {
            try {
              const preview = await this.media.getIdentityPreviewUrl(item.user.id, purpose);
              return [purpose, preview?.url ?? null] as const;
            } catch {
              return [purpose, null] as const;
            }
          }),
      );
      return { ...item, documents: Object.fromEntries(previews) };
    }));
  }

  async decideIdentityVerification(reviewerId: string, caseId: string, decision: "APPROVED" | "REJECTED", reason: string) {
    const trimmedReason = reason.trim();
    if (decision === "REJECTED" && trimmedReason.length < 5) {
      throw new ConflictException("A rejection reason of at least 5 characters is required.");
    }
    const verificationCase = await this.prisma.identityVerificationCase.findUnique({
      where: { id: caseId },
      select: { id: true, userId: true, status: true },
    });
    if (!verificationCase) throw new NotFoundException("Identity verification case not found.");
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Use the same per-user lock as identity submission so a reviewer decision
      // cannot race a new submission and accidentally downgrade VERIFIED status.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('provider-eligibility'), hashtext(${verificationCase.userId}))`;
      const currentCase = await tx.identityVerificationCase.findUnique({
        where: { id: caseId },
        select: { id: true, userId: true, status: true },
      });
      if (!currentCase) throw new NotFoundException("Identity verification case not found.");
      if (currentCase.userId === reviewerId) throw new ForbiddenException("Reviewers cannot verify their own identity.");
      if (currentCase.status !== VerificationCaseStatus.SUBMITTED && currentCase.status !== VerificationCaseStatus.UNDER_REVIEW) {
        throw new ConflictException("This identity verification case has already been decided.");
      }
      const changed = await tx.identityVerificationCase.updateMany({
        where: { id: caseId, status: { in: [VerificationCaseStatus.SUBMITTED, VerificationCaseStatus.UNDER_REVIEW] } },
        data: { status: decision === "APPROVED" ? VerificationCaseStatus.APPROVED : VerificationCaseStatus.REJECTED,
          reviewerId, reviewedAt: now, decisionReason: trimmedReason || null },
      });
      if (changed.count !== 1) throw new ConflictException("This identity verification case has already been decided.");
      const approvedSkills = await tx.providerSkill.findMany({
        where: { userId: currentCase.userId, status: "APPROVED" },
        select: { category: true },
        orderBy: { category: "asc" },
      });
      const user = await tx.user.findUniqueOrThrow({ where: { id: currentCase.userId },
        select: { providerRoleStatus: true, seekerRoleStatus: true, activeMarketplaceMode: true } });
      const identityStatus = decision === "APPROVED" ? IdentityVerificationStatus.VERIFIED : IdentityVerificationStatus.FAILED;
      const providerActive = decision === "APPROVED" && approvedSkills.length > 0 && user.providerRoleStatus !== MarketplaceRoleStatus.SUSPENDED;
      if (providerActive) {
        const draft = await tx.onboardingDraft.findUnique({ where: { userId: currentCase.userId }, select: { profile: true } });
        const profile = draft?.profile && typeof draft.profile === "object" && !Array.isArray(draft.profile)
          ? draft.profile as Record<string, unknown> : {};
        const fullName = [profile.firstName, profile.lastName].filter((value) => typeof value === "string" && value.trim()).join(" ");
        const publicName = [profile.businessName, fullName].find((value) => typeof value === "string" && value.trim()) as string | undefined;
        if (publicName) {
          await tx.providerProfile.upsert({
            where: { userId: currentCase.userId },
            create: { userId: currentCase.userId, publicName: publicName.trim(), skillCategories: approvedSkills.map((item) => item.category), isAvailable: false },
            update: { publicName: publicName.trim(), skillCategories: approvedSkills.map((item) => item.category) },
          });
        }
      }
      if (!providerActive) {
        await tx.providerProfile.updateMany({
          where: { userId: currentCase.userId },
          data: {
            isAvailable: false,
            liveLatitude: null,
            liveLongitude: null,
            liveAccuracyM: null,
            liveLocationUpdatedAt: null,
          },
        });
      }
      await tx.user.update({ where: { id: currentCase.userId }, data: {
        identityVerification: identityStatus, identityVerifiedAt: decision === "APPROVED" ? now : null,
        providerRoleStatus: user.providerRoleStatus === MarketplaceRoleStatus.SUSPENDED
          ? MarketplaceRoleStatus.SUSPENDED
          : providerActive ? MarketplaceRoleStatus.ACTIVE : MarketplaceRoleStatus.PENDING,
        activeMarketplaceMode: user.activeMarketplaceMode === RegistrationMode.PROVIDER && !providerActive
          ? (user.seekerRoleStatus === MarketplaceRoleStatus.ACTIVE ? RegistrationMode.SEEKER : null)
          : providerActive && user.activeMarketplaceMode === null && user.seekerRoleStatus !== MarketplaceRoleStatus.ACTIVE
            ? RegistrationMode.PROVIDER : user.activeMarketplaceMode,
      } });
      await tx.staffAuditLog.create({ data: { actorId: reviewerId, targetUserId: currentCase.userId,
        action: `IDENTITY_VERIFICATION_${decision}`, metadata: { caseId, reason: trimmedReason || null } } });
      await tx.appNotification.create({ data: { userId: currentCase.userId,
        title: decision === "APPROVED" ? "Identity verified" : "Identity verification rejected",
        body: decision === "APPROVED" ? "Your identity has been verified." : trimmedReason,
        data: { type: "IDENTITY_VERIFICATION_DECISION", caseId, decision } } });
    });
    return { caseId, status: decision === "APPROVED" ? "VERIFIED" : "REJECTED", reason: trimmedReason || null };
  }

  async listSkillReviews() {
    const skills = await this.prisma.providerSkill.findMany({
      where: { status: "PENDING" },
      orderBy: { submittedAt: "asc" },
      take: 300,
      select: { id: true, category: true, details: true, status: true, submittedAt: true,
        user: { select: { id: true, email: true, identityVerification: true } } },
    });

    return Promise.all(skills.map(async (skill) => {
      const details = skill.details && typeof skill.details === "object" && !Array.isArray(skill.details)
        ? skill.details as Record<string, unknown>
        : {};
      const assetIds = new Set<string>();
      for (const qualification of Array.isArray(details.licencesQualifications) ? details.licencesQualifications : []) {
        if (qualification && typeof qualification === "object" &&
            typeof (qualification as Record<string, unknown>).attachmentUrl === "string") {
          assetIds.add(String((qualification as Record<string, unknown>).attachmentUrl));
        }
      }
      for (const work of Array.isArray(details.portfolio) ? details.portfolio : []) {
        if (work && typeof work === "object" && Array.isArray((work as Record<string, unknown>).imageUrls)) {
          for (const assetId of (work as Record<string, unknown>).imageUrls as unknown[]) {
            if (typeof assetId === "string") assetIds.add(assetId);
          }
        }
      }
      const providerEvidence = Object.fromEntries(await Promise.all([...assetIds].map(async (assetId) => {
        try {
          const preview = await this.media.getProviderEvidencePreviewUrl(skill.user.id, assetId);
          return [assetId, preview?.url ?? null] as const;
        } catch {
          return [assetId, null] as const;
        }
      })));
      return { ...skill, providerEvidence };
    }));
  }

  async decideSkill(reviewerId: string, skillId: string, decision: "APPROVED" | "REJECTED", reason: string) {
    const trimmedReason = reason.trim();
    if (decision === "REJECTED" && trimmedReason.length < 5) {
      throw new ConflictException("A rejection reason of at least 5 characters is required.");
    }
    const initialSkill = await this.prisma.providerSkill.findUnique({
      where: { id: skillId },
      select: { id: true, userId: true },
    });
    if (!initialSkill) throw new NotFoundException("Skill not found.");
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Serialize all eligibility changes for one Provider account. Identity
      // decisions, skill decisions and Provider applications use this same lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('provider-eligibility'), hashtext(${initialSkill.userId}))`;
      const currentSkill = await tx.providerSkill.findUnique({
        where: { id: skillId },
        select: {
          id: true,
          userId: true,
          status: true,
          user: { select: { identityVerification: true, providerRoleStatus: true, seekerRoleStatus: true, activeMarketplaceMode: true } },
        },
      });
      if (!currentSkill) throw new NotFoundException("Skill not found.");
      if (currentSkill.userId !== initialSkill.userId) throw new ConflictException("Skill ownership changed. Refresh and try again.");
      if (currentSkill.userId === reviewerId) throw new ForbiddenException("Reviewers cannot approve their own skills.");
      if (currentSkill.status !== "PENDING") throw new ConflictException("This skill has already been decided.");
      if (decision === "APPROVED" && currentSkill.user.identityVerification !== IdentityVerificationStatus.VERIFIED) {
        throw new ConflictException("Identity must be verified before a skill can be approved.");
      }

      const changed = await tx.providerSkill.updateMany({
        where: { id: skillId, userId: currentSkill.userId, status: "PENDING" },
        data: { status: decision, reviewerId, reviewedAt: now, decisionReason: trimmedReason || null },
      });
      if (changed.count !== 1) throw new ConflictException("This skill has already been decided.");

      const approvedSkills = await tx.providerSkill.findMany({
        where: { userId: currentSkill.userId, status: "APPROVED" },
        select: { category: true },
        orderBy: { category: "asc" },
      });
      const providerActive = currentSkill.user.identityVerification === IdentityVerificationStatus.VERIFIED &&
        approvedSkills.length > 0 && currentSkill.user.providerRoleStatus !== MarketplaceRoleStatus.SUSPENDED;
      if (providerActive) {
        const draft = await tx.onboardingDraft.findUnique({ where: { userId: currentSkill.userId }, select: { profile: true } });
        const profile = draft?.profile && typeof draft.profile === "object" && !Array.isArray(draft.profile)
          ? draft.profile as Record<string, unknown> : {};
        const fullName = [profile.firstName, profile.lastName]
          .filter((value) => typeof value === "string" && value.trim()).join(" ");
        const publicName = [profile.businessName, fullName]
          .find((value) => typeof value === "string" && value.trim()) as string | undefined;
        if (publicName) {
          await tx.providerProfile.upsert({
            where: { userId: currentSkill.userId },
            create: { userId: currentSkill.userId, publicName: publicName.trim(), skillCategories: approvedSkills.map((item) => item.category), isAvailable: false },
            update: { publicName: publicName.trim(), skillCategories: approvedSkills.map((item) => item.category) },
          });
        }
      }
      if (!providerActive) {
        await tx.providerProfile.updateMany({
          where: { userId: currentSkill.userId },
          data: {
            isAvailable: false,
            liveLatitude: null,
            liveLongitude: null,
            liveAccuracyM: null,
            liveLocationUpdatedAt: null,
          },
        });
      }
      await tx.user.update({
        where: { id: currentSkill.userId },
        data: {
          providerRoleStatus: currentSkill.user.providerRoleStatus === MarketplaceRoleStatus.SUSPENDED
            ? MarketplaceRoleStatus.SUSPENDED
            : providerActive ? MarketplaceRoleStatus.ACTIVE : MarketplaceRoleStatus.PENDING,
          activeMarketplaceMode: providerActive && currentSkill.user.activeMarketplaceMode === null &&
            currentSkill.user.seekerRoleStatus !== MarketplaceRoleStatus.ACTIVE
            ? RegistrationMode.PROVIDER
            : currentSkill.user.activeMarketplaceMode,
        },
      });
      await tx.staffAuditLog.create({
        data: {
          actorId: reviewerId,
          targetUserId: currentSkill.userId,
          action: `PROVIDER_SKILL_${decision}`,
          metadata: { skillId, reason: trimmedReason || null },
        },
      });
      await tx.appNotification.create({
        data: {
          userId: currentSkill.userId,
          title: decision === "APPROVED" ? "Skill approved" : "Skill rejected",
          body: decision === "APPROVED" ? `Your skill "${skillId}" has been approved.` : trimmedReason,
          data: { type: "PROVIDER_SKILL_DECISION", skillId, decision },
        },
      });
    });
    return { skillId, status: decision, reason: trimmedReason || null };
  }

  async getAdminDashboardMetrics() {
    const now = new Date();
    const [activeProviders, activeSeekers, jobsInProgress, completedJobs, scheduledJobs, pendingJobs, pendingApplications, applicationsUnderReview] = await Promise.all([
      this.prisma.user.count({ where: { providerRoleStatus: MarketplaceRoleStatus.ACTIVE, identityVerification: "VERIFIED", deletedAt: null } }),
      this.prisma.user.count({ where: { seekerRoleStatus: MarketplaceRoleStatus.ACTIVE, deletedAt: null } }),
      this.prisma.jobEngagement.count({ where: { status: "IN_PROGRESS" } }),
      this.prisma.jobEngagement.count({ where: { status: "COMPLETED" } }),
      this.prisma.jobEngagement.count({ where: { status: "ESTIMATE_APPROVED", request: { preferredStartAt: { gt: now } } } }),
      this.prisma.serviceRequest.count({ where: { status: "OPEN" } }),
      this.prisma.providerRoleApplication.count({ where: { status: ProviderApplicationStatus.PENDING } }),
      this.prisma.providerRoleApplication.count({ where: { status: ProviderApplicationStatus.UNDER_REVIEW } }),
    ]);
    return {
      activeProviders, activeSeekers, jobsInProgress, completedJobs, scheduledJobs, pendingJobs,
      pendingApplications, applicationsUnderReview, generatedAt: now.toISOString(),
    };
  }


}
