import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { IsArray, IsObject, IsOptional } from "class-validator";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser, AuthenticatedUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { OnboardingService } from "./onboarding.service";

class SaveOnboardingDto {
  @IsOptional() @IsObject() profile?: Record<string, unknown>;
  @IsOptional() @IsArray() skills?: unknown[];
  @IsOptional() @IsArray() portfolio?: unknown[];
}

@Controller("profile/onboarding")
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}
  @Get() get(@CurrentUser() user: AuthenticatedUser) { return this.onboarding.get(user.id); }
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Patch() save(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveOnboardingDto) { return this.onboarding.save(user.id, dto); }
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("submit") submit(@CurrentUser() user: AuthenticatedUser) { return this.onboarding.submit(user.id); }
}
