import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { RedisThrottlerStorage } from "./security/redis-throttler.storage";
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
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const redisConfigured = Boolean(
          process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
        );
        if (process.env.NODE_ENV === "production" || redisConfigured ||
            process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN) {
          return {
            throttlers: [{ ttl: 60_000, limit: 100 }],
            storage: new RedisThrottlerStorage(),
          };
        }

        // Local development can run without external infrastructure. Production
        // deliberately refuses to start without a shared atomic rate-limit store.
        return { throttlers: [{ ttl: 60_000, limit: 100 }] };
      },
    }),
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
