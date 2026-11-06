import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { IdentityModule } from "./identity/identity.module";

@Module({
  imports: [DatabaseModule, AuthModule, IdentityModule],
  controllers: [HealthController],
})
export class AppModule {}
