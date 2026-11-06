import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthenticatedUser } from "../auth/current-user.decorator";
import { IdentityRequiredAction, canPerformVerifiedAction } from "./identity-verification.policy";

export const IDENTITY_REQUIRED_ACTION = "identity_required_action";

/**
 * Apply only to consequential action endpoints, such as submitting a Seeker
 * request or accepting a Provider request. Do not apply to browse/read routes
 * or incoming-request delivery.
 */
@Injectable()
export class MarketplaceAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const action = this.reflector.getAllAndOverride<IdentityRequiredAction>(
      IDENTITY_REQUIRED_ACTION,
      [context.getHandler(), context.getClass()],
    );
    if (!action) {
      throw new ForbiddenException({
        code: "IDENTITY_ACTION_POLICY_MISSING",
        message: "This marketplace action has no identity-verification policy configured.",
      });
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user || !canPerformVerifiedAction(
      request.user.identityVerification.toLowerCase() as "verified" | "not_started" | "pending" | "failed" | "requires_information" | "suspended" | "revoked",
      action,
    )) {
      throw new ForbiddenException({
        code: "IDENTITY_VERIFICATION_REQUIRED",
        action,
        message: action === "SEEKER_SUBMIT_REQUEST"
          ? "Complete identity verification before submitting your service request."
          : "You can view this request, but you must complete identity verification before accepting it.",
      });
    }
    return true;
  }
}
