import { Module } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { IdentityModule } from "../identity/identity.module";
import { DatabaseModule } from "../database/database.module";
import { MarketplaceController } from "./marketplace.controller";
import { MarketplaceService } from "./marketplace.service";

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService, JwtAuthGuard],
})
export class MarketplaceModule {}
