import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { MarketplaceRoleStatus, ProviderApplicationStatus, RegistrationMode, StaffRole } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

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
      skills: [...new Set(input.skills.map((value) => value.trim()).filter(Boolean))],
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

  async listProviderApplications() {
    return this.prisma.providerRoleApplication.findMany({
      where: { status: { in: [ProviderApplicationStatus.PENDING, ProviderApplicationStatus.UNDER_REVIEW] } },
      orderBy: { submittedAt: "asc" },
      select: {
        id: true,
        status: true,
        applicationData: true,
        submittedAt: true,
        user: { select: { id: true, email: true, identityVerification: true } },
      },
    });
  }

  async decideProviderApplication(
    reviewerId: string,
    applicationId: string,
    decision: "APPROVED" | "REJECTED" | "NEEDS_INFORMATION",
    reason: string,
  ) {
    const application = await this.prisma.providerRoleApplication.findUnique({
      where: { id: applicationId },
      select: { id: true, userId: true, status: true },
    });
    if (!application) throw new NotFoundException("Provider application not found.");
    if (![ProviderApplicationStatus.PENDING, ProviderApplicationStatus.UNDER_REVIEW].includes(application.status)) {
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

      await tx.user.update({
        where: { id: application.userId },
        data: {
          providerRoleStatus: roleStatus,
          ...(decision === "APPROVED" ? {} : { activeMarketplaceMode: RegistrationMode.SEEKER }),
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
}
