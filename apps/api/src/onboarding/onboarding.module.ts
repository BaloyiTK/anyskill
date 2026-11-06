import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";
@Module({ imports: [DatabaseModule], controllers: [OnboardingController], providers: [OnboardingService] })
export class OnboardingModule {}
