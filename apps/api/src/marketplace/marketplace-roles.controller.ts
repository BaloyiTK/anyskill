import { Body, Controller, Get, Patch, Post, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import { RegistrationMode, StaffRole } from "@prisma/client";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
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

class ProviderApplicationDecisionDto {
  @IsIn(["APPROVED", "REJECTED", "NEEDS_INFORMATION"])
  decision!: "APPROVED" | "REJECTED" | "NEEDS_INFORMATION";

  @IsString() @MinLength(5) @MaxLength(1000)
  reason!: string;
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

  @Get("admin/provider-applications")
  @UseGuards(StaffAccessGuard)
  @RequireStaffRole(StaffRole.PROVIDER_REVIEWER)
  listProviderApplications() {
    return this.roles.listProviderApplications();
  }

  @Post("admin/provider-applications/:applicationId/decision")
  @UseGuards(StaffAccessGuard)
  @RequireStaffRole(StaffRole.PROVIDER_REVIEWER)
  decideProviderApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param("applicationId", new ParseUUIDPipe()) applicationId: string,
    @Body() dto: ProviderApplicationDecisionDto,
  ) {
    return this.roles.decideProviderApplication(user.id, applicationId, dto.decision, dto.reason);
  }
}
