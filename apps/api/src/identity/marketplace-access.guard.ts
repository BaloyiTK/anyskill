import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthenticatedUser } from "../auth/current-user.decorator";
import { IdentityRequiredAction, canPerformVerifiedAction } from "./identity-verification.policy";

export const IDENTITY_REQUIRED_ACTION = "identity_required_action";

/** Mark only a consequential action endpoint as requiring verified identity. */
export const RequireIdentityFor = (action: IdentityRequiredAction) =>
  SetMetadata(IDENTITY_REQUIRED_ACTION, action);

/**
 * Apply only to consequential action endpoints:
 * @RequireIdentityFor("SEEKER_SUBMIT_REQUEST") or
 * @RequireIdentityFor("PROVIDER_ACCEPT_REQUEST").
 * Do not apply to browse/read routes or incoming-request delivery.
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
    const status = request.user?.identityVerification?.toLowerCase();
    if (!status || !canPerformVerifiedAction(
      status as Parameters<typeof canPerformVerifiedAction>[0],
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
