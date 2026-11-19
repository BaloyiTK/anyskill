import "dotenv/config";
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  ArgumentsHost,
  ExceptionFilter,
  Catch,
  HttpException,
  Logger,
  ValidationPipe,
} from "@nestjs/common";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { MarketplaceService } from "./marketplace/marketplace.service";
import { LiveProviderMapService } from "./marketplace/live-provider-map.service";

const MAX_ERROR_LOG_BYTES = 5 * 1024 * 1024;
const LOG_DIRECTORY = join(__dirname, "..", "logs");
const ERROR_LOG_FILE = join(LOG_DIRECTORY, "error.log");

function validateProductionConfiguration(): void {
  if (process.env.NODE_ENV !== "production") return;

  const required = ["DATABASE_URL", "JWT_ACCESS_SECRET", "SMTP_HOST", "MAIL_FROM", "GOOGLE_PLACES_API_KEY"];
  const missing = required.filter((key) => !process.env[key]?.trim());
  const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim();
  const cloudinaryPartsPresent = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
    process.env.CLOUDINARY_API_KEY?.trim() &&
    process.env.CLOUDINARY_API_SECRET?.trim(),
  );
  let cloudinaryUrlValid = false;
  if (cloudinaryUrl) {
    try {
      const parsed = new URL(cloudinaryUrl);
      cloudinaryUrlValid = parsed.protocol === "cloudinary:" &&
        Boolean(parsed.hostname && parsed.username && parsed.password);
    } catch {
      cloudinaryUrlValid = false;
    }
  }
  if (!cloudinaryUrlValid && !cloudinaryPartsPresent) {
    missing.push("valid CLOUDINARY_URL (or all CLOUDINARY_* split credentials)");
  }
  const jwtSecret = process.env.JWT_ACCESS_SECRET?.trim() ?? "";
  if (jwtSecret && (jwtSecret.length < 32 || /replace|example|changeme|your[_ -]?secret/i.test(jwtSecret))) {
    throw new Error("JWT_ACCESS_SECRET must be a unique random secret of at least 32 characters in production.");
  }
  const smtpUser = Boolean(process.env.SMTP_USER?.trim());
  const smtpPassword = Boolean(process.env.SMTP_PASSWORD?.trim());
  if (smtpUser !== smtpPassword) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must either both be configured or both be empty.");
  }
  const smtpPort = Number(process.env.SMTP_PORT?.trim() || 587);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port in production.");
  }
  const smtpSecure = process.env.SMTP_SECURE?.trim().toLowerCase();
  if (smtpSecure && smtpSecure !== "true" && smtpSecure !== "false") {
    throw new Error("SMTP_SECURE must be either true or false.");
  }
  if (missing.length > 0) {
    throw new Error(`Missing required production configuration: ${missing.join(", ")}`);
  }
}

function redactLogText(value: string): string {
  return value
    .replace(/(api[_-]?secret|authorization|password|access[_-]?token|refresh[_-]?token|signature)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[REDACTED]")
    .slice(0, 12_000);
}

function writeErrorLog(entry: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "production") {
    // Container platforms collect stdout/stderr. Never rely on ephemeral
    // filesystem logs in production; emit one redacted JSON record per line.
    process.stderr.write(JSON.stringify(entry) + String.fromCharCode(10));
    return;
  }

  const logDirectory = LOG_DIRECTORY;
  const logFile = ERROR_LOG_FILE;
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
class ApiExceptionFilter implements ExceptionFilter {
  private readonly errorLogger = new Logger("API-ERROR");

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
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

    const httpAdapter = this.httpAdapterHost.httpAdapter;
    const httpContext = host.switchToHttp();
    const response = exception instanceof HttpException
      ? exception.getResponse()
      : { statusCode: 500, message: "Internal server error" };
    const responseBody = typeof response === "object" && response !== null
      ? response
      : { statusCode, message: response };

    httpAdapter.reply(httpContext.getResponse(), responseBody, statusCode);
  }
}

async function bootstrap(): Promise<void> {
  validateProductionConfiguration();
  // The HTTP entrypoint must never run marketplace polling, even if a worker
  // environment variable is accidentally inherited by the API deployment.
  process.env.ANYSKILL_PROCESS_ROLE = "api";
  const logger = new Logger("HTTP");
  if (process.env.NODE_ENV !== "production") {
    mkdirSync(LOG_DIRECTORY, { recursive: true });
    appendFileSync(ERROR_LOG_FILE, "", { encoding: "utf8", mode: 0o600 });
  }
  const app = await NestFactory.create(AppModule);

  // Express only trusts forwarded client IP headers from the configured number
  // of proxy hops. Never enable blanket "trust proxy" in production.
  const trustProxyHops = process.env.TRUST_PROXY_HOPS === undefined
    ? 0
    : Number(process.env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) {
    throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 10.");
  }
  const expressInstance = app.getHttpAdapter().getInstance() as {
    set(name: string, value: number): void;
  };
  expressInstance.set("trust proxy", trustProxyHops);
  logger.log(`Express trusted proxy hops: ${trustProxyHops}`);

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
        writeErrorLog({
          timestamp: new Date().toISOString(),
          level: "error",
          statusCode: response.statusCode,
          method,
          path,
          requestId,
          message: "HTTP request returned a server error.",
        });
      } else if (response.statusCode >= 400) {
        logger.warn(message);
        writeErrorLog({
          timestamp: new Date().toISOString(),
          level: "warn",
          statusCode: response.statusCode,
          method,
          path,
          requestId,
          message: "HTTP request returned a client error.",
        });
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

  const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  // Local Admin Portal development is served from port 4173. Production must
  // always provide an explicit allow-list of deployed frontend origins.
  const allowedOrigins = process.env.NODE_ENV !== "production"
    ? [...new Set([...configuredOrigins, "http://localhost:4173", "http://127.0.0.1:4173"])]
    : configuredOrigins;

  if (process.env.NODE_ENV === "production" && allowedOrigins.length === 0) {
    throw new Error("CORS_ALLOWED_ORIGINS must contain the exact deployed browser origins in production.");
  }
  for (const origin of allowedOrigins) {
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error(`Invalid CORS origin configured: ${origin}`);
    }
    if (!["https:", "http:"].includes(parsedOrigin.protocol) ||
        parsedOrigin.origin !== origin ||
        (process.env.NODE_ENV === "production" && parsedOrigin.protocol !== "https:")) {
      throw new Error(`CORS origin must be an exact origin without a path; production origins must use HTTPS: ${origin}`);
    }
  }

  if (allowedOrigins.length > 0) {
    app.enableCors({ origin: allowedOrigins, credentials: true });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
  app.get(LiveProviderMapService).attach(
    app.getHttpServer(),
    (latitude, longitude, radiusKm) =>
      app.get(MarketplaceService).discoverNearbyProviders(latitude, longitude, radiusKm),
  );
  // Expire pins promptly when a Provider disconnects without explicitly going offline.
  const staleLocationSweep = setInterval(() => app.get(LiveProviderMapService).notifyChanged(), 10_000);
  staleLocationSweep.unref();
  logger.log(`API listening on http://0.0.0.0:${port}/api/v1`);
  if (process.env.NODE_ENV !== "production") logger.log(`API error log file: ${ERROR_LOG_FILE}`);
  logger.log(
    allowedOrigins.length > 0
      ? `CORS allowed origins: ${allowedOrigins.join(", ")}`
      : "CORS_ALLOWED_ORIGINS is empty; browser cross-origin requests are not enabled.",
  );
}

void bootstrap();
