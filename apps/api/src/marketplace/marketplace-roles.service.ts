import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { MarketplaceRoleStatus, ProviderApplicationStatus, RegistrationMode, StaffRole } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

export type StaffMemberUpdate = { role?: StaffRole; isActive?: boolean };

export type ProviderApplicationInput = {
  publicName: string;
  skills: string[];
  portfolio: string[];
  qualifications?: string[];
};

@Injectable()
export class MarketplaceRolesService {
  constructor(private readonly prisma: PrismaService) {}

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
    const user = await this.prisma.user.findUniqueOrThrow({
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

  async listProviderApplications() {
    return this.prisma.providerRoleApplication.findMany({
      where: { status: { in: [ProviderApplicationStatus.PENDING, ProviderApplicationStatus.UNDER_REVIEW] } },
      orderBy: { submittedAt: "asc" },
      take: 100,
      select: {
        id: true,
        status: true,
        applicationData: true,
        submittedAt: true,
        user: { select: { id: true, email: true, identityVerification: true } },
      },
    });
  }

  async startProviderApplicationReview(reviewerId: string, applicationId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const application = await tx.providerRoleApplication.findUnique({
        where: { id: applicationId },
        select: { userId: true },
      });
      if (!application) throw new NotFoundException("Provider application not found.");
      if (application.userId === reviewerId) throw new ForbiddenException("Reviewers cannot review their own Provider application.");
      const changed = await tx.providerRoleApplication.updateMany({
        where: { id: applicationId, status: ProviderApplicationStatus.PENDING },
        data: { status: ProviderApplicationStatus.UNDER_REVIEW, reviewerId },
      });
      if (changed.count !== 1) {
        throw new ConflictException("This Provider application is not pending review.");
      }
      await tx.staffAuditLog.create({
        data: {
          actorId: reviewerId,
          targetUserId: application.userId,
          action: "PROVIDER_APPLICATION_REVIEW_STARTED",
          metadata: { applicationId },
        },
      });
      return { applicationId, status: ProviderApplicationStatus.UNDER_REVIEW };
    });
    return result;
  }

  async decideProviderApplication(
    reviewerId: string,
    applicationId: string,
    decision: "APPROVED" | "REJECTED" | "NEEDS_INFORMATION",
    reason: string,
  ) {
    const application = await this.prisma.providerRoleApplication.findUnique({
      where: { id: applicationId },
      select: { id: true, userId: true, status: true, applicationData: true, user: { select: { seekerRoleStatus: true } } },
    });
    if (!application) throw new NotFoundException("Provider application not found.");
    if (application.userId === reviewerId) throw new ForbiddenException("Reviewers cannot decide their own Provider application.");
    if (application.status !== ProviderApplicationStatus.PENDING && application.status !== ProviderApplicationStatus.UNDER_REVIEW) {
      throw new ConflictException("This Provider application has already been decided.");
    }

    const applicationStatus: ProviderApplicationStatus = decision === "APPROVED"
      ? ProviderApplicationStatus.APPROVED
      : decision === "REJECTED"
        ? ProviderApplicationStatus.REJECTED
        : ProviderApplicationStatus.NEEDS_INFORMATION;
    const roleStatus: MarketplaceRoleStatus = decision === "APPROVED"
      ? MarketplaceRoleStatus.ACTIVE
      : decision === "REJECTED"
        ? MarketplaceRoleStatus.REJECTED
        : MarketplaceRoleStatus.REQUIRES_INFORMATION;

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.providerRoleApplication.updateMany({
        where: {
          id: applicationId,
          status: { in: [ProviderApplicationStatus.PENDING, ProviderApplicationStatus.UNDER_REVIEW] },
        },
        data: {
          status: applicationStatus,
          reviewerId,
          reviewedAt: new Date(),
          decisionReason: reason.trim(),
        },
      });
      if (changed.count !== 1) throw new ConflictException("This Provider application has already been decided.");

      if (decision === "APPROVED") {
        const submitted = application.applicationData;
        if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
          throw new ConflictException("The submitted Provider profile is incomplete and cannot be approved.");
        }
        const data = submitted as Record<string, unknown>;
        const publicName = typeof data.publicName === "string" ? data.publicName.trim() : "";
        const skills = Array.isArray(data.skills)
          ? data.skills.filter((value): value is string => typeof value === "string").map((value) => value.trim().toLocaleLowerCase("en-ZA")).filter(Boolean)
          : [];
        if (!publicName || skills.length === 0) {
          throw new ConflictException("The submitted Provider profile is incomplete and cannot be approved.");
        }
        await tx.providerProfile.upsert({
          where: { userId: application.userId },
          create: {
            userId: application.userId,
            publicName,
            skillCategories: skills,
            isAvailable: false,
          },
          update: {
            publicName,
            skillCategories: skills,
            isAvailable: false,
            liveLatitude: null,
            liveLongitude: null,
            liveAccuracyM: null,
            liveLocationUpdatedAt: null,
          },
        });
      }

      await tx.user.update({
        where: { id: application.userId },
        data: {
          providerRoleStatus: roleStatus,
          activeMarketplaceMode: application.user.seekerRoleStatus === MarketplaceRoleStatus.ACTIVE
            ? RegistrationMode.SEEKER
            : decision === "APPROVED" ? RegistrationMode.PROVIDER : null,
        },
      });
      await tx.staffAuditLog.create({
        data: {
          actorId: reviewerId,
          targetUserId: application.userId,
          action: `PROVIDER_APPLICATION_${decision}`,
          metadata: { applicationId, reason: reason.trim() },
        },
      });
      await tx.appNotification.create({
        data: {
          userId: application.userId,
          title: decision === "APPROVED" ? "Provider role approved" : decision === "REJECTED" ? "Provider application not approved" : "More information required",
          body: reason.trim(),
          data: { type: "PROVIDER_ROLE_APPLICATION_DECISION", applicationId, decision },
        },
      });
    });

    return { applicationId, status: applicationStatus, providerRoleStatus: roleStatus };
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
