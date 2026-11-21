import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthenticatedUser } from "../auth/current-user.decorator";

export type MarketplaceRole = "SEEKER" | "PROVIDER";
const MARKETPLACE_ROLE_KEY = "marketplace_required_role";

export const RequireMarketplaceRole = (role: MarketplaceRole) => SetMetadata(MARKETPLACE_ROLE_KEY, role);

@Injectable()
export class MarketplaceRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const role = this.reflector.getAllAndOverride<MarketplaceRole>(MARKETPLACE_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!role) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    const status = role === "SEEKER" ? user?.seekerRoleStatus : user?.providerRoleStatus;
    if (status !== "ACTIVE") {
      throw new ForbiddenException({
        code: "MARKETPLACE_ROLE_NOT_ACTIVE",
        role,
        status: status ?? "NOT_AVAILABLE",
        message: role === "PROVIDER"
          ? "Provider access requires an approved Provider application."
          : "Activate your Seeker role before using Seeker features.",
      });
    }
    return true;
  }
}
