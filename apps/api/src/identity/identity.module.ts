import { Module } from "@nestjs/common";
import { IdentityController } from "./identity.controller";
import { MarketplaceAccessGuard } from "./marketplace-access.guard";
import { MediaService } from "../marketplace/media.service";

@Module({
  controllers: [IdentityController],
  providers: [MarketplaceAccessGuard, MediaService],
  exports: [MarketplaceAccessGuard],
})
export class IdentityModule {}
