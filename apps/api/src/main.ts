import "dotenv/config";
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const logger = new Logger("HTTP");
  const app = await NestFactory.create(AppModule);

  app.use((
    request: { method: string; originalUrl?: string; url: string },
    response: {
      setHeader(name: string, value: string): void;
      once(event: "finish", listener: () => void): void;
      statusCode: number;
    },
    next: () => void,
  ) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const method = request.method;
    const path = (request.originalUrl ?? request.url).split("?")[0];

    response.setHeader("x-request-id", requestId);
    response.once("finish", () => {
      const durationMs = Date.now() - startedAt;
      const message = `${method} ${path} ${response.statusCode} ${durationMs}ms requestId=${requestId}`;

      if (response.statusCode >= 500) {
        logger.error(message);
      } else if (response.statusCode >= 400) {
        logger.warn(message);
      } else {
        logger.log(message);
      }
    });

    next();
  });

  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();

  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.length > 0) {
    app.enableCors({ origin: allowedOrigins, credentials: true });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
  logger.log(`API listening on http://0.0.0.0:${port}/api/v1`);
  logger.log(
    allowedOrigins.length > 0
      ? `CORS allowed origins: ${allowedOrigins.join(", ")}`
      : "CORS_ALLOWED_ORIGINS is empty; browser cross-origin requests are not enabled.",
  );
}

void bootstrap();
