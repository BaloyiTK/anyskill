import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { IdentityModule } from "../identity/identity.module";
import { DatabaseModule } from "../database/database.module";
import { MarketplaceController } from "./marketplace.controller";
import { MarketplaceService } from "./marketplace.service";
import { MediaService } from "./media.service";

@Module({
  imports: [DatabaseModule, IdentityModule, PassportModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService, MediaService, JwtAuthGuard],
})
export class MarketplaceModule {}
