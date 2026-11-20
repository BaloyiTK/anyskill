import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Liveness: confirms the HTTP process is running. It deliberately does not
  // depend on downstream services so orchestrators do not restart a healthy
  // process merely because PostgreSQL is temporarily unavailable.
  @Get()
  check(): { status: "ok"; service: "anyskill-api"; timestamp: string } {
    return {
      status: "ok",
      service: "anyskill-api",
      timestamp: new Date().toISOString(),
    };
  }

  // Worker readiness is separate from API readiness. Deployments should monitor
  // this endpoint on the worker process; a missing or stale heartbeat is unhealthy.
  @Get("worker")
  async workerReadiness(): Promise<{
    status: "healthy";
    service: "anyskill-marketplace-worker";
    lastSuccessAt: string | null;
    consecutiveFailures: number;
    timestamp: string;
  }> {
    const heartbeat = await this.prisma.workerHeartbeat.findUnique({ where: { name: "marketplace" } });
    const stale = !heartbeat
      || Date.now() - heartbeat.heartbeatAt.getTime() > 180_000
      || !heartbeat.lastSuccessAt
      || Date.now() - heartbeat.lastSuccessAt.getTime() > 180_000;
    if (!heartbeat || stale || heartbeat.status === "DEGRADED") {
      throw new ServiceUnavailableException({
        status: "not_ready",
        service: "anyskill-marketplace-worker",
        lastHeartbeatAt: heartbeat?.heartbeatAt.toISOString() ?? null,
        consecutiveFailures: heartbeat?.consecutiveFailures ?? null,
        lastErrorCode: heartbeat?.lastErrorCode ?? null,
      });
    }
    return {
      status: "healthy",
      service: "anyskill-marketplace-worker",
      lastSuccessAt: heartbeat.lastSuccessAt?.toISOString() ?? null,
      consecutiveFailures: heartbeat.consecutiveFailures,
      timestamp: new Date().toISOString(),
    };
  }

  // Readiness: only route traffic to this instance when its database
  // connection is usable. Migration compatibility is enforced by deployment
  // (db:deploy) and is not inferred from a successful SELECT 1.
  @Get("ready")
  async readiness(): Promise<{
    status: "ready";
    service: "anyskill-api";
    dependencies: { database: "ok" };
    timestamp: string;
  }> {
    try {
      await this.prisma.$queryRawUnsafe("SELECT 1");
    } catch {
      throw new ServiceUnavailableException({
        status: "not_ready",
        service: "anyskill-api",
        dependencies: { database: "unavailable" },
      });
    }

    return {
      status: "ready",
      service: "anyskill-api",
      dependencies: { database: "ok" },
      timestamp: new Date().toISOString(),
    };
  }
}
