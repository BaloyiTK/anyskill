import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { MailModule } from "../mail/mail.module";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";

@Module({
  imports: [DatabaseModule, MailModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
