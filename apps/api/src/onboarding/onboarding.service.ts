import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
          if (!Array.isArray(value) || value.length < 1 || value.length > 2 || value.some((role) => role !== "SEEKER" && role !== "PROVIDER") || new Set(value).size !== value.length) {
            throw new BadRequestException("Select Skill Seeker, Skill Provider, or both.");
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
      skills: skills.some((s) => typeof s?.category === "string" && s.category.trim() && typeof s?.description === "string" && s.description.trim()),
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
    const draft = await this.prisma.onboardingDraft.upsert({
      where: { userId }, create: { userId, profile: {}, skills: [], portfolio: [], submittedAt: new Date() },
      update: { submittedAt: new Date() },
    });
    return { submittedAt: draft.submittedAt, message: "Your available onboarding information has been saved. You can continue editing incomplete sections later." };
  }
}
