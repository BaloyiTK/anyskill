import {
  BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from "@nestjs/common";
import { IsBoolean, IsOptional, IsUUID } from "class-validator";
import { CurrentUser, AuthenticatedUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MarketplaceAccessGuard, RequireIdentityFor } from "../identity/marketplace-access.guard";
import { MarketplaceRoleGuard, RequireMarketplaceRole } from "./marketplace-role.guard";
import {
  CreateServiceRequestDto,
  UpdateHomeLocationDto, UpdateLiveLocationDto,
  RegisterPushDeviceDto,
  UpdateProviderProfileDto,
  SelectProviderDto, SubmitEstimateDto, DecideEstimateDto, RequestAdditionalHoursDto, DecideAdditionalHoursDto, SubmitJobCompletionDto, DecideJobCompletionDto, ScheduleServiceRequestDto, SubmitProviderReviewDto, SubmitSeekerReviewDto, OpenJobDisputeDto, PostJobDisputeMessageDto, ResolveJobDisputeDto,
} from "./dto/service-request.dto";
import { MarketplaceService } from "./marketplace.service";
import { StaffAccessGuard, RequireStaffRole } from "./staff-access.guard";
import { StaffRole } from "@prisma/client";
import { MediaService } from "./media.service";
import { GooglePlacesService } from "./google-places.service";
import { PayFastService } from "./payfast.service";
import { IsInt, IsNumber, IsString, Max, MaxLength, Min } from "class-validator";

class StartPayFastCheckoutDto {
  @IsOptional() @IsBoolean() saveCard?: boolean;
}
class ChargeSavedCardDto {
  @IsString() @MaxLength(64) paymentMethodId!: string;
}

class CreateMediaUploadDto {
  @IsString() @MaxLength(255) fileName!: string;
  @IsString() @MaxLength(100) contentType!: string;
  @IsOptional() @IsString() purpose?: "JOB_COMPLETION_EVIDENCE" | "JOB_DISPUTE_EVIDENCE";
  @IsInt() @Min(1) @Max(10485760) sizeBytes!: number;
}
class ConfirmMediaUploadDto { @IsString() @MaxLength(64) assetId!: string; }
class SendServiceChatMessageDto { @IsString() @MaxLength(2000) body!: string; }
class SaveAssessmentDraftDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.25) @Max(10000)
  estimatedHours?: number | null;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

class CursorQuery {
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

@Controller()
@UseGuards(JwtAuthGuard, MarketplaceRoleGuard)
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService, private readonly media: MediaService, private readonly payfast: PayFastService) {}

  @Get("profile/location/home")
  getHomeLocation(@CurrentUser() user: AuthenticatedUser) { return this.marketplace.getHomeLocation(user.id); }

  @Patch("profile/location/home")
  updateHomeLocation(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateHomeLocationDto) { return this.marketplace.updateHomeLocation(user.id, dto); }

  @Post("marketplace/provider-location/live")
  @RequireMarketplaceRole("PROVIDER")
  updateProviderLiveLocation(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateLiveLocationDto) { return this.marketplace.updateProviderLiveLocation(user.id, dto); }

  @Post("marketplace/media/uploads")
  createMediaUpload(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMediaUploadDto) { return this.media.createUpload(user.id, dto); }

  @Post("marketplace/media/uploads/confirm")
  confirmMediaUpload(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConfirmMediaUploadDto) { return this.media.confirmUpload(user.id, dto.assetId); }

  @Get("marketplace/media/:assetId/url")
  getEvidenceUrl(@CurrentUser() user: AuthenticatedUser, @Param("assetId") assetId: string) { return this.media.getEvidenceUrl(user.id, assetId); }

  @Get("marketplace/skills")
  listSkills(@Query("q") query?: string) { return this.marketplace.listSkills(query ?? ""); }

  @Post("marketplace/requests")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("SEEKER_SUBMIT_REQUEST")
  @RequireMarketplaceRole("SEEKER")
  createRequest(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateServiceRequestDto) {
    return this.marketplace.createRequest(user.id, dto);
  }

  @Get("marketplace/incoming-requests")
  @RequireMarketplaceRole("PROVIDER")
  incomingRequests(@CurrentUser() user: AuthenticatedUser, @Query() query: CursorQuery) {
    return this.marketplace.listIncomingRequests(user.id, query.cursor);
  }

  @Get("marketplace/provider-profile/availability")
  @RequireMarketplaceRole("PROVIDER")
  providerAvailability(@CurrentUser() user: AuthenticatedUser) {
    return this.marketplace.getProviderAvailability(user.id);
  }

  @Get("marketplace/my-offers")
  @RequireMarketplaceRole("PROVIDER")
  myOffers(@CurrentUser() user: AuthenticatedUser) {
    return this.marketplace.listMyOffers(user.id);
  }

  @Get("marketplace/my-requests")
  @RequireMarketplaceRole("SEEKER")
  myRequests(@CurrentUser() user: AuthenticatedUser) {
    return this.marketplace.listMyRequests(user.id);
  }

  @Post("marketplace/requests/:requestId/accept")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_ACCEPT_REQUEST")
  @RequireMarketplaceRole("PROVIDER")
  acceptRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
  ) {
    return this.marketplace.respondToRequest(user.id, requestId);
  }


  @Post("marketplace/requests/:requestId/decline")
  @RequireMarketplaceRole("PROVIDER")
  declineIncomingRequest(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.declineIncomingRequest(user.id, requestId);
  }

  @Post("marketplace/requests/:requestId/cancel")
  @RequireMarketplaceRole("SEEKER")
  cancelRequest(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.cancelRequest(user.id, requestId);
  }

  @Post("marketplace/requests/:requestId/provider-cancel")
  @RequireMarketplaceRole("PROVIDER")
  cancelSelectedJob(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.cancelSelectedJob(user.id, requestId);
  }

  @Post("marketplace/requests/:requestId/offers/:responseId/withdraw")
  @RequireMarketplaceRole("PROVIDER")
  withdrawProviderOffer(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
    @Param("responseId", new ParseUUIDPipe()) responseId: string,
  ) {
    return this.marketplace.withdrawProviderOffer(user.id, requestId, responseId);
  }

  @Post("marketplace/requests/:requestId/schedule")
  @RequireMarketplaceRole("SEEKER")
  scheduleRequest(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Body() dto: ScheduleServiceRequestDto) {
    return this.marketplace.scheduleRequest(user.id, requestId, dto);
  }

  @Post("marketplace/requests/:requestId/offers/:responseId/decline")
  @RequireMarketplaceRole("SEEKER")
  declineProviderOffer(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
    @Param("responseId", new ParseUUIDPipe()) responseId: string,
  ) {
    return this.marketplace.declineProviderOffer(user.id, requestId, responseId);
  }

  @Post("marketplace/requests/:requestId/select-provider")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("SEEKER_SELECT_PROVIDER")
  @RequireMarketplaceRole("SEEKER")
  selectProvider(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
    @Body() dto: SelectProviderDto,
  ) {
    return this.marketplace.selectProvider(user.id, requestId, dto.responseId);
  }



  @Post("marketplace/requests/:requestId/disputes")
  openJobDispute(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Body() dto: OpenJobDisputeDto) {
    return this.marketplace.openJobDispute(user.id, requestId, dto);
  }

  @Get("marketplace/requests/:requestId/disputes")
  getJobDispute(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.listJobDispute(user.id, requestId);
  }

  @Post("marketplace/requests/:requestId/disputes/:disputeId/messages")
  postJobDisputeMessage(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Param("disputeId", new ParseUUIDPipe()) disputeId: string, @Body() dto: PostJobDisputeMessageDto) {
    return this.marketplace.postJobDisputeMessage(user.id, requestId, disputeId, dto);
  }

  @Get("admin/marketplace/disputes")
  @UseGuards(StaffAccessGuard)
  @RequireStaffRole(StaffRole.SUPPORT_AGENT)
  listOpenJobDisputes() { return this.marketplace.listOpenJobDisputes(); }

  @Post("admin/marketplace/disputes/:disputeId/resolve")
  @UseGuards(StaffAccessGuard)
  @RequireStaffRole("SUPPORT_AGENT")
  resolveJobDispute(@CurrentUser() user: AuthenticatedUser, @Param("disputeId", new ParseUUIDPipe()) disputeId: string, @Body() dto: ResolveJobDisputeDto) {
    return this.marketplace.resolveJobDispute(user.id, disputeId, dto);
  }

  @Post("marketplace/requests/:requestId/completion")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_SUBMIT_COMPLETION")
  @RequireMarketplaceRole("PROVIDER")
  submitJobCompletion(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Body() dto: SubmitJobCompletionDto) {
    return this.marketplace.submitJobCompletion(user.id, requestId, dto);
  }

  @Post("marketplace/requests/:requestId/payment/payfast")
  @RequireMarketplaceRole("SEEKER")
  startPayFastCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
    @Body() dto: StartPayFastCheckoutDto,
  ) {
    return this.payfast.createJobCheckout(user.id, requestId, dto.saveCard === true);
  }

  @Post("marketplace/requests/:requestId/payment/payfast/saved-card")
  @RequireMarketplaceRole("SEEKER")
  chargeSavedPayFastCard(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
    @Body() dto: ChargeSavedCardDto,
  ) {
    return this.payfast.chargeSavedCard(user.id, requestId, dto.paymentMethodId);
  }

  @Get("marketplace/payment-methods")
  @RequireMarketplaceRole("SEEKER")
  listSavedPaymentMethods(@CurrentUser() user: AuthenticatedUser) {
    return this.payfast.listSavedPaymentMethods(user.id);
  }

  @Delete("marketplace/payment-methods/:paymentMethodId")
  @RequireMarketplaceRole("SEEKER")
  removeSavedPaymentMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Param("paymentMethodId", new ParseUUIDPipe()) paymentMethodId: string,
  ) {
    return this.payfast.removeSavedPaymentMethod(user.id, paymentMethodId);
  }

  @Post("marketplace/requests/:requestId/payment/simulate")
  @RequireMarketplaceRole("SEEKER")
  simulateJobPayment(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.simulateJobPayment(user.id, requestId);
  }

  @Post("marketplace/requests/:requestId/completion/:submissionId/decision")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("SEEKER_REVIEW_COMPLETION")
  @RequireMarketplaceRole("SEEKER")
  async decideJobCompletion(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Param("submissionId", new ParseUUIDPipe()) submissionId: string, @Body() dto: DecideJobCompletionDto) {
    const completion = await this.marketplace.decideJobCompletion(user.id, requestId, submissionId, dto);
    if (!dto.approved || completion.jobStatus !== "COMPLETED") return completion;

    // The Seeker is charged only after approving the Provider's completed work.
    // Keep completion/earnings committed even if the saved-card debit needs attention.
    try {
      const paymentInitiation = await this.payfast.chargeDefaultSavedCard(user.id, requestId);
      return { ...completion, paymentInitiation };
    } catch (error) {
      return {
        ...completion,
        paymentInitiation: {
          success: false,
          status: "FAILED",
          message: error instanceof Error ? error.message : "The saved-card charge could not be initiated. Please review your payment method.",
        },
      };
    }
  }

  @Get("marketplace/requests/:requestId/chat")
  getServiceChat(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.listServiceChatMessages(user.id, requestId);
  }

  @Post("marketplace/requests/:requestId/chat")
  sendServiceChat(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Body() dto: SendServiceChatMessageDto) {
    return this.marketplace.sendServiceChatMessage(user.id, requestId, dto.body);
  }

  @Post("marketplace/requests/:requestId/provider-en-route")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_ACCEPT_REQUEST")
  @RequireMarketplaceRole("PROVIDER")
  markProviderEnRoute(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.markProviderEnRoute(user.id, requestId);
  }

  @Post("marketplace/requests/:requestId/provider-arrived")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_ACCEPT_REQUEST")
  @RequireMarketplaceRole("PROVIDER")
  markProviderArrived(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.markProviderArrived(user.id, requestId);
  }

  @Post("marketplace/requests/:requestId/confirm-provider-arrival")
  @RequireMarketplaceRole("SEEKER")
  confirmProviderArrival(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.confirmProviderArrival(user.id, requestId);
  }

  @Post("marketplace/requests/:requestId/assessment/start")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_ACCEPT_REQUEST")
  @RequireMarketplaceRole("PROVIDER")
  startAssessment(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.startAssessment(user.id, requestId);
  }

  @Patch("marketplace/requests/:requestId/assessment/draft")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_ACCEPT_REQUEST")
  @RequireMarketplaceRole("PROVIDER")
  saveAssessmentDraft(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Body() dto: SaveAssessmentDraftDto) {
    return this.marketplace.saveAssessmentDraft(user.id, requestId, dto);
  }

  @Post("marketplace/requests/:requestId/assessment/complete")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_ACCEPT_REQUEST")
  @RequireMarketplaceRole("PROVIDER")
  completeAssessment(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.completeAssessment(user.id, requestId);
  }

  @Get("marketplace/requests/:requestId/provider-route")
  @RequireMarketplaceRole("PROVIDER")
  getProviderRoute(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe()) requestId: string,
    @Query("originLatitude") originLatitude: string,
    @Query("originLongitude") originLongitude: string,
  ) {
    return this.marketplace.getProviderRoute(user.id, requestId, originLatitude, originLongitude);
  }

  @Get("marketplace/my-jobs")
  @RequireMarketplaceRole("PROVIDER")
  myJobs(@CurrentUser() user: AuthenticatedUser) { return this.marketplace.listMyJobs(user.id); }

  @Post("marketplace/requests/:requestId/rating")
  @RequireMarketplaceRole("SEEKER")
  submitProviderReview(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Body() dto: SubmitProviderReviewDto) {
    return this.marketplace.submitProviderReview(user.id, requestId, dto);
  }

  @Post("marketplace/requests/:requestId/seeker-rating")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_SUBMIT_COMPLETION")
  @RequireMarketplaceRole("PROVIDER")
  submitSeekerReview(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Body() dto: SubmitSeekerReviewDto) {
    return this.marketplace.submitSeekerReview(user.id, requestId, dto);
  }

  @Post("marketplace/requests/:requestId/estimate")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_SUBMIT_ESTIMATE")
  @RequireMarketplaceRole("PROVIDER")
  submitEstimate(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Body() dto: SubmitEstimateDto) {
    return this.marketplace.submitEstimate(user.id, requestId, dto);
  }

  @Post("marketplace/requests/:requestId/estimate-decision")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("SEEKER_DECIDE_ESTIMATE")
  @RequireMarketplaceRole("SEEKER")
  decideEstimate(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Body() dto: DecideEstimateDto) {
    return this.marketplace.decideEstimate(user.id, requestId, dto);
  }

  @Post("marketplace/requests/:requestId/start-work")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_START_WORK")
  @RequireMarketplaceRole("PROVIDER")
  startWork(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.startWork(user.id, requestId);
  }

  @Post("marketplace/requests/:requestId/work-break")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_START_WORK")
  @RequireMarketplaceRole("PROVIDER")
  pauseWork(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.pauseWork(user.id, requestId);
  }

  @Post("marketplace/requests/:requestId/resume-work")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_START_WORK")
  @RequireMarketplaceRole("PROVIDER")
  resumeWork(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string) {
    return this.marketplace.resumeWork(user.id, requestId);
  }

  @Post("marketplace/requests/:requestId/additional-hours")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_REQUEST_EXTRA_HOURS")
  @RequireMarketplaceRole("PROVIDER")
  requestAdditionalHours(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Body() dto: RequestAdditionalHoursDto) {
    return this.marketplace.requestAdditionalHours(user.id, requestId, dto);
  }

  @Post("marketplace/requests/:requestId/additional-hours/:adjustmentId/decision")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("SEEKER_DECIDE_EXTRA_HOURS")
  @RequireMarketplaceRole("SEEKER")
  decideAdditionalHours(@CurrentUser() user: AuthenticatedUser, @Param("requestId", new ParseUUIDPipe()) requestId: string, @Param("adjustmentId", new ParseUUIDPipe()) adjustmentId: string, @Body() dto: DecideAdditionalHoursDto) {
    return this.marketplace.decideAdditionalHours(user.id, requestId, adjustmentId, dto);
  }

  @Get("marketplace/provider-earnings/today")
  @RequireMarketplaceRole("PROVIDER")
  getProviderDailyEarnings(@CurrentUser() user: AuthenticatedUser) {
    return this.marketplace.getProviderDailyEarnings(user.id);
  }

  @Get("marketplace/provider-profile")
  @RequireMarketplaceRole("PROVIDER")
  getProviderProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.marketplace.getProviderProfile(user.id);
  }

  @Post("marketplace/provider-profile")
  @RequireMarketplaceRole("PROVIDER")
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

// Public, privacy-preserving discovery used by the signed-out welcome map.
@Controller()
export class PublicProviderDiscoveryController {
  constructor(private readonly marketplace: MarketplaceService, private readonly places: GooglePlacesService) {}

  @Get("marketplace/places/autocomplete")
  autocompletePlaces(
    @Query("input") input: string,
    @Query("sessionToken") sessionToken: string,
    @Query("latitude") latitude?: string,
    @Query("longitude") longitude?: string,
  ) {
    return this.places.autocomplete(input, sessionToken, latitude, longitude);
  }

  @Get("marketplace/places/reverse-geocode")
  reverseGeocode(
    @Query("latitude") latitude: string,
    @Query("longitude") longitude: string,
  ) {
    return this.places.reverseGeocode(latitude, longitude);
  }

  @Get("marketplace/places/details/:placeId")
  getPlaceDetails(
    @Param("placeId") placeId: string,
    @Query("sessionToken") sessionToken: string,
  ) {
    return this.places.getPlaceDetails(placeId, sessionToken);
  }

  @Get("marketplace/discover/providers")
  discoverProviders(
    @Query("latitude") latitudeValue: string,
    @Query("longitude") longitudeValue: string,
    @Query("radiusKm") radiusValue: string,
  ) {
    const latitude = Number(latitudeValue);
    const longitude = Number(longitudeValue);
    const radiusKm = Number(radiusValue);
    if (!latitudeValue || !longitudeValue || !radiusValue ||
        !Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radiusKm)) {
      throw new BadRequestException("Latitude, longitude and radiusKm are required.");
    }
    return this.marketplace.discoverNearbyProviders(latitude, longitude, radiusKm);
  }
}
