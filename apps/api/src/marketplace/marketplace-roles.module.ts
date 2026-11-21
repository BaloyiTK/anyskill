import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MarketplaceRolesController } from "./marketplace-roles.controller";
import { MarketplaceRolesService } from "./marketplace-roles.service";
import { StaffAccessGuard } from "./staff-access.guard";
import { MediaService } from "./media.service";

@Module({
  imports: [DatabaseModule],
  controllers: [MarketplaceRolesController],
  providers: [MarketplaceRolesService, MediaService, JwtAuthGuard, StaffAccessGuard],
  exports: [MarketplaceRolesService],
})
export class MarketplaceRolesModule {}
