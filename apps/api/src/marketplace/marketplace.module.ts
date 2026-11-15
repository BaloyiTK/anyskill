import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { IdentityModule } from "../identity/identity.module";
import { MarketplaceRolesModule } from "./marketplace-roles.module";
import { MarketplaceRoleGuard } from "./marketplace-role.guard";
import { DatabaseModule } from "../database/database.module";
import { MarketplaceController, PublicProviderDiscoveryController } from "./marketplace.controller";
import { MarketplaceService } from "./marketplace.service";
import { MediaService } from "./media.service";

@Module({
  imports: [DatabaseModule, IdentityModule, MarketplaceRolesModule, PassportModule],
  controllers: [MarketplaceController, PublicProviderDiscoveryController],
  providers: [MarketplaceService, MediaService, JwtAuthGuard, MarketplaceRoleGuard],
  exports: [MediaService],
})
export class MarketplaceModule {}
