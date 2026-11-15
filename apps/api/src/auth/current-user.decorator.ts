import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface AuthenticatedUser {
  id: string;
  email: string;
  emailVerified: boolean;
  identityVerification: string;
  seekerRoleStatus: string;
  providerRoleStatus: string;
  activeMarketplaceMode: "SEEKER" | "PROVIDER" | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);
