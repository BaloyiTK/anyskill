import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUser, AuthenticatedUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PrismaService } from "../database/prisma.service";

class SubmitIdentityVerificationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerReference?: string;
}

@Controller("identity-verification")
@UseGuards(JwtAuthGuard)
export class IdentityController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("status")
  async status(@CurrentUser() user: AuthenticatedUser) {
    const [account, latestCase] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { identityVerification: true, identityVerifiedAt: true },
      }),
      this.prisma.identityVerificationCase.findFirst({
        where: { userId: user.id },
        orderBy: { submittedAt: "desc" },
        select: { id: true, status: true, submittedAt: true, reviewedAt: true, decisionReason: true },
      }),
    ]);

    return {
      status: account.identityVerification.toLowerCase(),
      verifiedAt: account.identityVerifiedAt,
      latestCase,
    };
  }

  @Post("submit")
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitIdentityVerificationDto,
  ) {
    const existingPending = await this.prisma.identityVerificationCase.findFirst({
      where: {
        userId: user.id,
        status: { in: ["SUBMITTED", "UNDER_REVIEW", "NEEDS_INFORMATION"] },
      },
    });

    if (existingPending) return { caseId: existingPending.id, status: existingPending.status.toLowerCase() };

    const verificationCase = await this.prisma.$transaction(async (tx) => {
      const created = await tx.identityVerificationCase.create({
        data: {
          userId: user.id,
          providerReference: dto.providerReference,
          status: "SUBMITTED",
        },
        select: { id: true, status: true, submittedAt: true },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { identityVerification: "PENDING", identityVerifiedAt: null },
      });

      return created;
    });

    return {
      caseId: verificationCase.id,
      status: verificationCase.status.toLowerCase(),
      submittedAt: verificationCase.submittedAt,
    };
  }
}
