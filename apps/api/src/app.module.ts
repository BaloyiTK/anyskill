import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { IdentityModule } from "./identity/identity.module";
import { MarketplaceModule } from "./marketplace/marketplace.module";
import { OnboardingModule } from "./onboarding/onboarding.module";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    IdentityModule,
    MarketplaceModule,
    OnboardingModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
