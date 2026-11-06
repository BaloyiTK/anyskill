import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from "@nestjs/common";
import { IsOptional, IsUUID } from "class-validator";
import { CurrentUser, AuthenticatedUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MarketplaceAccessGuard, RequireIdentityFor } from "../identity/marketplace-access.guard";
import {
  CreateServiceRequestDto,
  ProviderResponseDto,
  RegisterPushDeviceDto,
  UpdateProviderProfileDto,
  SelectProviderDto, SubmitEstimateDto, DecideEstimateDto, RequestAdditionalHoursDto, DecideAdditionalHoursDto,
} from "./dto/service-request.dto";
import { MarketplaceService } from "./marketplace.service";

class CursorQuery {
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Post("marketplace/requests")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("SEEKER_SUBMIT_REQUEST")
  createRequest(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateServiceRequestDto) {
    return this.marketplace.createRequest(user.id, dto);
  }

  @Get("marketplace/incoming-requests")
  incomingRequests(@CurrentUser() user: AuthenticatedUser, @Query() query: CursorQuery) {
    return this.marketplace.listIncomingRequests(user.id, query.cursor);
  }

  @Get("marketplace/my-requests")
  myRequests(@CurrentUser() user: AuthenticatedUser) {
    return this.marketplace.listMyRequests(user.id);
  }

  @Post("marketplace/requests/:requestId/accept")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_ACCEPT_REQUEST")
  acceptRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
    @Body() dto: ProviderResponseDto,
  ) {
    return this.marketplace.respondToRequest(user.id, requestId, dto);
  }


  @Post("marketplace/requests/:requestId/select-provider")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("SEEKER_SELECT_PROVIDER")
  selectProvider(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
    @Body() dto: SelectProviderDto,
  ) {
    return this.marketplace.selectProvider(user.id, requestId, dto.responseId);
  }


  @Get("marketplace/my-jobs")
  myJobs(@CurrentUser() user: AuthenticatedUser) { return this.marketplace.listMyJobs(user.id); }

  @Post("marketplace/requests/:requestId/estimate")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_SUBMIT_ESTIMATE")
  submitEstimate(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Body() dto: SubmitEstimateDto) {
    return this.marketplace.submitEstimate(user.id, requestId, dto);
  }

  @Post("marketplace/requests/:requestId/estimate-decision")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("SEEKER_DECIDE_ESTIMATE")
  decideEstimate(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Body() dto: DecideEstimateDto) {
    return this.marketplace.decideEstimate(user.id, requestId, dto);
  }

  @Post("marketplace/requests/:requestId/start-work")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_START_WORK")
  startWork(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.startWork(user.id, requestId);
  }

  @Post("marketplace/requests/:requestId/additional-hours")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_REQUEST_EXTRA_HOURS")
  requestAdditionalHours(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Body() dto: RequestAdditionalHoursDto) {
    return this.marketplace.requestAdditionalHours(user.id, requestId, dto);
  }

  @Post("marketplace/requests/:requestId/additional-hours/:adjustmentId/decision")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("SEEKER_DECIDE_EXTRA_HOURS")
  decideAdditionalHours(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Param("adjustmentId", new ParseUUIDPipe()) adjustmentId: string, @Body() dto: DecideAdditionalHoursDto) {
    return this.marketplace.decideAdditionalHours(user.id, requestId, adjustmentId, dto);
  }

  @Get("marketplace/provider-profile")
  getProviderProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.marketplace.getProviderProfile(user.id);
  }

  @Post("marketplace/provider-profile")
  updateProviderProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProviderProfileDto) {
    return this.marketplace.updateProviderProfile(user.id, dto);
  }

  @Post("notifications/devices")
  registerPushDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterPushDeviceDto) {
    return this.marketplace.registerPushDevice(user.id, dto);
  }

  @Get("notifications")
  notifications(@CurrentUser() user: AuthenticatedUser) {
    return this.marketplace.listNotifications(user.id);
  }

  @Patch("notifications/:notificationId/read")
  markNotificationRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param("notificationId", new ParseUUIDPipe()) notificationId: string,
  ) {
    return this.marketplace.markNotificationRead(user.id, notificationId);
  }
}
