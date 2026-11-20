import "dotenv/config";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { validateProductionConfiguration } from "./config/production-config";

async function bootstrapWorker(): Promise<void> {
  if (process.env.ANYSKILL_PROCESS_ROLE !== "worker") {
    throw new Error("Set ANYSKILL_PROCESS_ROLE=worker when starting the dedicated AnySkill worker.");
  }

  validateProductionConfiguration("worker");
  const logger = new Logger("AnySkillWorker");
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  logger.log("Worker application context is ready.");
}

void bootstrapWorker().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[AnySkillWorker] Startup failed: ${message}\n`);
  process.exitCode = 1;
});
