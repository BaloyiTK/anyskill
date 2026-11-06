import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/current-user.decorator";

/**
 * Apply to every marketplace route. Authentication alone is insufficient:
 * both Skill Seekers and Skill Providers need a verified identity.
 */
@Injectable()
export class MarketplaceAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user || request.user.identityVerification !== "VERIFIED") {
      throw new ForbiddenException({
        code: "IDENTITY_VERIFICATION_REQUIRED",
        message: "Complete identity verification before accessing the marketplace.",
      });
    }
    return true;
  }
}
