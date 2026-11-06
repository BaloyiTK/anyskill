import { Module } from "@nestjs/common";
import { IdentityController } from "./identity.controller";
import { MarketplaceAccessGuard } from "./marketplace-access.guard";

@Module({
  controllers: [IdentityController],
  providers: [MarketplaceAccessGuard],
  exports: [MarketplaceAccessGuard],
})
export class IdentityModule {}
