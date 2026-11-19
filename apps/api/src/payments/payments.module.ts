import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [DatabaseModule],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
