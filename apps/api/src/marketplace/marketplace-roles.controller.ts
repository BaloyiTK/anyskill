import { Body, Controller, Get, Patch, Post, Param, ParseUUIDPipe, UseGuards, StreamableFile } from "@nestjs/common";
import { RegistrationMode, StaffRole } from "@prisma/client";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser, AuthenticatedUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MarketplaceRolesService, ProviderApplicationInput } from "./marketplace-roles.service";
import { RequireStaffRole, StaffAccessGuard } from "./staff-access.guard";

class SwitchMarketplaceModeDto {
  @IsEnum(RegistrationMode)
  mode!: RegistrationMode;
}

class ProviderApplicationDto implements ProviderApplicationInput {
  @IsString() @MinLength(2) @MaxLength(80)
  publicName!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(100, { each: true })
  skills!: string[];

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(1000, { each: true })
  portfolio!: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(200, { each: true })
  qualifications?: string[];
}

class CreateStaffMemberDto {
  @IsString() @MaxLength(320)
  email!: string;

  @IsEnum(StaffRole)
  role!: StaffRole;
}

class UpdateStaffMemberDto {
  @IsOptional() @IsEnum(StaffRole)
  role?: StaffRole;

  @IsOptional() @IsIn([true, false])
  isActive?: boolean;
}

class ReviewDecisionDto {
  @IsIn(["APPROVED", "REJECTED"])
  decision!: "APPROVED" | "REJECTED";

  @IsOptional() @IsString() @MaxLength(1000)
  reason?: string;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class MarketplaceRolesController {
  constructor(private readonly roles: MarketplaceRolesService) {}

  @Get("marketplace/roles")
  getRoles(@CurrentUser() user: AuthenticatedUser) {
    return this.roles.getRoles(user.id);
  }

  @Patch("marketplace/roles/active-mode")
  switchMode(@CurrentUser() user: AuthenticatedUser, @Body() dto: SwitchMarketplaceModeDto) {
    return this.roles.switchMode(user.id, dto.mode);
  }

  @Post("marketplace/roles/seeker/activate")
  activateSeeker(@CurrentUser() user: AuthenticatedUser) {
    return this.roles.activateSeeker(user.id);
  }

  @Post("marketplace/roles/provider/applications")
  submitProviderApplication(@CurrentUser() user: AuthenticatedUser, @Body() dto: ProviderApplicationDto) {
    return this.roles.submitProviderApplication(user.id, dto);
  }

  @Get("admin/dashboard/metrics")
  @UseGuards(StaffAccessGuard)
  @RequireStaffRole(StaffRole.ADMIN)
  getAdminDashboardMetrics() {
    return this.roles.getAdminDashboardMetrics();
  }

  @Get("admin/staff")
  @UseGuards(StaffAccessGuard)
  @RequireStaffRole(StaffRole.SUPER_ADMIN)
  listStaffMembers() {
    return this.roles.listStaffMembers();
  }

  @Post("admin/staff")
  @UseGuards(StaffAccessGuard)
  @RequireStaffRole(StaffRole.SUPER_ADMIN)
  createStaffMember(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStaffMemberDto) {
    return this.roles.createStaffMember(user.id, dto.email, dto.role);
  }

  @Patch("admin/staff/:userId")
  @UseGuards(StaffAccessGuard)
  @RequireStaffRole(StaffRole.SUPER_ADMIN)
  updateStaffMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Body() dto: UpdateStaffMemberDto,
  ) {
    return this.roles.updateStaffMember(user.id, userId, dto);
  }


  @Get("admin/accounts")
  @UseGuards(StaffAccessGuard)
  @RequireStaffRole(StaffRole.ADMIN)
  listAdminAccounts() {
    return this.roles.listAdminAccounts();
  }

  @Get("admin/identity-reviews")
  @UseGuards(StaffAccessGuard)
  @RequireStaffRole(StaffRole.IDENTITY_REVIEWER)
  listIdentityReviews(@CurrentUser() user: AuthenticatedUser) {
    return this.roles.listIdentityReviews(user.id);
  }

  @Get("admin/identity-reviews/:caseId/documents/:purpose")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(StaffAccessGuard)
  @RequireStaffRole(StaffRole.IDENTITY_REVIEWER)
  async getIdentityReviewDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param("caseId", new ParseUUIDPipe()) caseId: string,
    @Param("purpose") purpose: string,
  ) {
    const document = await this.roles.getIdentityDocumentForReviewer(user.id, caseId, purpose);
    return new StreamableFile(document.bytes, {
      type: document.contentType,
      disposition: "inline",
      length: document.bytes.length,
    });
  }

  @Post("admin/identity-reviews/:caseId/decision")
  @UseGuards(StaffAccessGuard)
  @RequireStaffRole(StaffRole.IDENTITY_REVIEWER)
  decideIdentityVerification(
    @CurrentUser() user: AuthenticatedUser,
    @Param("caseId", new ParseUUIDPipe()) caseId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.roles.decideIdentityVerification(user.id, caseId, dto.decision, dto.reason ?? "");
  }

  @Get("admin/skill-reviews")
  @UseGuards(StaffAccessGuard)
  @RequireStaffRole(StaffRole.PROVIDER_REVIEWER)
  listSkillReviews(@CurrentUser() user: AuthenticatedUser) {
    return this.roles.listSkillReviews(user.id);
  }

  @Post("admin/skill-reviews/:skillId/decision")
  @UseGuards(StaffAccessGuard)
  @RequireStaffRole(StaffRole.PROVIDER_REVIEWER)
  decideSkill(
    @CurrentUser() user: AuthenticatedUser,
    @Param("skillId", new ParseUUIDPipe()) skillId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.roles.decideSkill(user.id, skillId, dto.decision, dto.reason ?? "");
  }

}
