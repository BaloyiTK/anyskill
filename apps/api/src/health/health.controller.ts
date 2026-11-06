import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  check(): { status: "ok"; service: "anyskill-api"; timestamp: string } {
    return {
      status: "ok",
      service: "anyskill-api",
      timestamp: new Date().toISOString(),
    };
  }
}
