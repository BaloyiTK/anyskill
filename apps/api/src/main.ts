import "dotenv/config";
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  ArgumentsHost,
  BaseExceptionFilter,
  Catch,
  HttpException,
  Logger,
  ValidationPipe,
} from "@nestjs/common";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

const MAX_ERROR_LOG_BYTES = 5 * 1024 * 1024;

function redactLogText(value: string): string {
  return value
    .replace(/(api[_-]?secret|authorization|password|access[_-]?token|refresh[_-]?token|signature)(\s*[:=]\s*)[^\\s,;]+/gi, "$1$2[REDACTED]")
    .slice(0, 12_000);
}

function writeErrorLog(entry: Record<string, unknown>): void {
  const logDirectory = join(process.cwd(), "logs");
  const logFile = join(logDirectory, "error.log");
  try {
    mkdirSync(logDirectory, { recursive: true });
    if (existsSync(logFile) && statSync(logFile).size >= MAX_ERROR_LOG_BYTES) {
      const backupFile = `${logFile}.1`;
      if (existsSync(backupFile)) unlinkSync(backupFile);
      renameSync(logFile, backupFile);
    }
    appendFileSync(logFile, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown log file error";
    process.stderr.write(`[ERROR-LOGGER] Could not write ${logFile}: ${redactLogText(message)}\\n`);
  }
}

@Catch()
class ApiExceptionFilter extends BaseExceptionFilter {
  private readonly errorLogger = new Logger("API-ERROR");

  override catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      requestId?: string;
    }>();
    const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;
    const errorName = exception instanceof Error ? exception.name : "UnknownError";
    const rawMessage = exception instanceof Error ? exception.message : String(exception);
    const message = redactLogText(rawMessage);
    const stack = exception instanceof Error && exception.stack
      ? redactLogText(exception.stack)
      : undefined;
    const path = (request.originalUrl ?? request.url ?? "").split("?")[0];
    const requestId = request.requestId ?? "unavailable";
    const level = statusCode >= 500 ? "error" : "warn";
    const summary = `${request.method ?? "UNKNOWN"} ${path} ${statusCode} ${errorName}: ${message} requestId=${requestId}`;

    if (statusCode >= 500) {
      this.errorLogger.error(summary, stack);
    } else {
      this.errorLogger.warn(summary);
    }

    writeErrorLog({
      timestamp: new Date().toISOString(),
      level,
      statusCode,
      method: request.method ?? "UNKNOWN",
      path,
      requestId,
      errorName,
      message,
      ...(stack ? { stack } : {}),
    });

    super.catch(exception, host);
  }
}

async function bootstrap(): Promise<void> {
  const logger = new Logger("HTTP");
  const app = await NestFactory.create(AppModule);

  app.use((
    request: { method: string; originalUrl?: string; url: string; requestId?: string },
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
    request.requestId = requestId;

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
  app.useGlobalFilters(new ApiExceptionFilter(app.get(HttpAdapterHost)));
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
  logger.log(`API error log file: ${join(process.cwd(), "logs", "error.log")}`);
  logger.log(
    allowedOrigins.length > 0
      ? `CORS allowed origins: ${allowedOrigins.join(", ")}`
      : "CORS_ALLOWED_ORIGINS is empty; browser cross-origin requests are not enabled.",
  );
}

void bootstrap();
