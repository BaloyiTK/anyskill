import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { IdentityModule } from "../identity/identity.module";
import { MarketplaceRolesModule } from "./marketplace-roles.module";
import { MarketplaceRoleGuard } from "./marketplace-role.guard";
import { StaffAccessGuard } from "./staff-access.guard";
import { DatabaseModule } from "../database/database.module";
import { MailModule } from "../mail/mail.module";
import { MarketplaceController, PublicProviderDiscoveryController } from "./marketplace.controller";
import { MarketplaceService } from "./marketplace.service";
import { MediaService } from "./media.service";
import { GooglePlacesService } from "./google-places.service";
import { LiveProviderMapService } from "./live-provider-map.service";

@Module({
  imports: [DatabaseModule, IdentityModule, MarketplaceRolesModule, PassportModule, MailModule],
  controllers: [MarketplaceController, PublicProviderDiscoveryController],
  providers: [MarketplaceService, MediaService, GooglePlacesService, LiveProviderMapService, JwtAuthGuard, MarketplaceRoleGuard, StaffAccessGuard],
  exports: [MediaService, MarketplaceService, LiveProviderMapService],
})
export class MarketplaceModule {}
