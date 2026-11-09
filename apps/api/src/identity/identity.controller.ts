import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  UseGuards,
  Body,
  BadRequestException,
} from "@nestjs/common";
import { IsInt, IsString, Max, MaxLength, Min } from "class-validator";
import { CurrentUser, AuthenticatedUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PrismaService } from "../database/prisma.service";
import { MediaService } from "../marketplace/media.service";

class CreateIdentityUploadDto {
  @IsString() @MaxLength(255) fileName!: string;
  @IsString() @MaxLength(100) contentType!: string;
  @IsInt() @Min(1) @Max(10485760) sizeBytes!: number;
  @IsString() purpose!: "ID_DOCUMENT" | "ID_SELFIE";
}
class ConfirmIdentityUploadDto { @IsString() @MaxLength(64) assetId!: string; }

@Controller("identity-verification")
@UseGuards(JwtAuthGuard)
export class IdentityController {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService) {}

  @Post("uploads")
  createUpload(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateIdentityUploadDto) {
    if (dto.purpose !== "ID_DOCUMENT" && dto.purpose !== "ID_SELFIE") throw new BadRequestException("Upload purpose must be ID_DOCUMENT or ID_SELFIE.");
    if (!Number.isInteger(dto.sizeBytes) || dto.sizeBytes < 1 || dto.sizeBytes > 10 * 1024 * 1024) throw new BadRequestException("Each image must be between 1 byte and 10 MB.");
    return this.media.createUpload(user.id, dto);
  }

  @Post("uploads/confirm")
  confirmUpload(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConfirmIdentityUploadDto) {
    return this.media.confirmUpload(user.id, dto.assetId);
  }

  @Get("status")
  async status(@CurrentUser() user: AuthenticatedUser) {
    const [account, latestCase, idDocument, selfie] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { identityVerification: true, identityVerifiedAt: true },
      }),
      this.prisma.identityVerificationCase.findFirst({
        where: { userId: user.id },
        orderBy: { submittedAt: "desc" },
        select: {
          id: true,
          status: true,
          submittedAt: true,
          reviewedAt: true,
          decisionReason: true,
        },
      }),
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_DOCUMENT", status: "READY" }, select: { id: true } }),
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_SELFIE", status: "READY" }, select: { id: true } }),
    ]);

    return {
      status: account.identityVerification.toLowerCase(),
      verifiedAt: account.identityVerifiedAt,
      latestCase,
      idDocumentUploaded: Boolean(idDocument),
      selfieUploaded: Boolean(selfie),
    };
  }

  @Post("submit")
  async submit(@CurrentUser() user: AuthenticatedUser) {
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { identityVerification: true },
    });

    if (account.identityVerification === "VERIFIED") {
      return { status: "verified", message: "Your identity is already verified." };
    }

    if (account.identityVerification === "SUSPENDED" || account.identityVerification === "REVOKED") {
      throw new ForbiddenException("Identity verification is suspended. Contact AnySkill support.");
    }

    const [idDocument, selfie] = await Promise.all([
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_DOCUMENT", status: "READY" }, orderBy: { uploadedAt: "desc" } }),
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_SELFIE", status: "READY" }, orderBy: { uploadedAt: "desc" } }),
    ]);
    if (!idDocument || !selfie) throw new BadRequestException("Upload your ID document and take a selfie before submitting verification.");

    const existingPending = await this.prisma.identityVerificationCase.findFirst({
      where: {
        userId: user.id,
        status: { in: ["SUBMITTED", "UNDER_REVIEW", "NEEDS_INFORMATION"] },
      },
      select: { id: true, status: true, submittedAt: true },
    });

    if (existingPending) {
      return {
        caseId: existingPending.id,
        status: existingPending.status.toLowerCase(),
        submittedAt: existingPending.submittedAt,
      };
    }

    const verificationCase = await this.prisma.$transaction(async (tx) => {
      const created = await tx.identityVerificationCase.create({
        data: { userId: user.id, status: "SUBMITTED", provider: "MANUAL_REVIEW", providerReference: "id:" + idDocument.id + ";selfie:" + selfie.id },
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
      message: "Your verification request has been recorded. Marketplace access remains locked until verification is approved.",
    };
  }
}
