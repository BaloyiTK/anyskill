import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { StaffRole } from "@prisma/client";
import { AuthenticatedUser } from "../auth/current-user.decorator";
import { PrismaService } from "../database/prisma.service";

const STAFF_ROLE_KEY = "required_staff_role";
export const RequireStaffRole = (role: StaffRole) => SetMetadata(STAFF_ROLE_KEY, role);

@Injectable()
export class StaffAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRole = this.reflector.getAllAndOverride<StaffRole>(STAFF_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRole) throw new ForbiddenException("A staff permission policy is required.");

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user?.id) throw new ForbiddenException("Staff access is required.");

    const membership = await this.prisma.staffMembership.findUnique({
      where: { userId: user.id },
      select: { role: true, isActive: true },
    });
    const isSuperAdmin = membership?.role === "SUPER_ADMIN";
    const isAdmin = membership?.role === "ADMIN";
    const allowed = requiredRole === "SUPER_ADMIN"
      ? isSuperAdmin
      : isSuperAdmin || isAdmin || membership?.role === requiredRole;
    if (!membership?.isActive || !allowed) {
      throw new ForbiddenException("You are not authorised to perform this staff action.");
    }
    return true;
  }
}
