import {
  Body, Controller, Get, Param, Post, Query, UseGuards,
} from "@nestjs/common";
import { IsOptional, IsUUID } from "class-validator";
import { CurrentUser, AuthenticatedUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MarketplaceAccessGuard, RequireIdentityFor } from "../identity/marketplace-access.guard";
import { CreateServiceRequestDto, ProviderResponseDto } from "./dto/service-request.dto";
import { MarketplaceService } from "./marketplace.service";

class CursorQuery {
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

@Controller("marketplace")
@UseGuards(JwtAuthGuard)
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Post("requests")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("SEEKER_SUBMIT_REQUEST")
  createRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateServiceRequestDto,
  ) {
    return this.marketplace.createRequest(user.id, dto);
  }

  /** Incoming requests remain readable by unverified providers. */
  @Get("incoming-requests")
  incomingRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CursorQuery,
  ) {
    return this.marketplace.listIncomingRequests(user.id, query.cursor);
  }

  @Get("my-requests")
  myRequests(@CurrentUser() user: AuthenticatedUser) {
    return this.marketplace.listMyRequests(user.id);
  }

  @Post("requests/:requestId/accept")
  @UseGuards(MarketplaceAccessGuard)
  @RequireIdentityFor("PROVIDER_ACCEPT_REQUEST")
  acceptRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId") requestId: string,
    @Body() dto: ProviderResponseDto,
  ) {
    return this.marketplace.respondToRequest(user.id, requestId, dto);
  }
}
