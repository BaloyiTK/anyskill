import "dotenv/config";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  // The worker is the only process that should run the marketplace poller
  // when API replicas are configured with MARKETPLACE_WORKER_ENABLED=false.
  process.env.MARKETPLACE_WORKER_ENABLED = "true";
  const logger = new Logger("MARKETPLACE-WORKER");
  const app = await NestFactory.createApplicationContext(AppModule);
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`Received ${signal}; stopping marketplace worker.`);
    await app.close();
  };
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.once("SIGINT", () => { void shutdown("SIGINT"); });
  logger.log("Marketplace worker started.");
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Marketplace worker failed to start: ${message}\n`);
  process.exitCode = 1;
});
