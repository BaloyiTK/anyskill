import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  UseGuards,
  Body,
  BadRequestException,
  Param,
} from "@nestjs/common";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { CurrentUser, AuthenticatedUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PrismaService } from "../database/prisma.service";
import { MediaService } from "../marketplace/media.service";

class CreateIdentityUploadDto {
  @IsString() @MaxLength(255) fileName!: string;
  @IsString() @MaxLength(100) contentType!: string;
  @IsInt() @Min(1) @Max(10485760) sizeBytes!: number;
  @IsString() purpose!: "ID_DOCUMENT" | "ID_DOCUMENT_FRONT" | "ID_DOCUMENT_BACK" | "ID_BOOK_PAGE_1" | "ID_BOOK_PAGE_2" | "ID_SELFIE";
}
class ConfirmIdentityUploadDto { @IsString() @MaxLength(64) assetId!: string; }
class IdentityUploadFailureDto {
  @IsString() @IsIn(["ID_DOCUMENT_FRONT", "ID_DOCUMENT_BACK", "ID_BOOK_PAGE_1", "ID_BOOK_PAGE_2", "ID_SELFIE"]) purpose!: string;
  @IsString() @IsIn(["read_file", "reserve", "cloudinary_upload", "confirm"]) stage!: string;
  @IsOptional() @IsInt() @Min(100) @Max(599) httpStatus?: number;
  @IsOptional() @IsString() @MaxLength(80) errorCode?: string;
}

@Controller("identity-verification")
@UseGuards(JwtAuthGuard)
export class IdentityController {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService) {}

  @Post("uploads")
  createUpload(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateIdentityUploadDto) {
    if (!["ID_DOCUMENT", "ID_DOCUMENT_FRONT", "ID_DOCUMENT_BACK", "ID_BOOK_PAGE_1", "ID_BOOK_PAGE_2", "ID_SELFIE"].includes(dto.purpose)) throw new BadRequestException("Unsupported identity upload purpose.");
    if (!Number.isInteger(dto.sizeBytes) || dto.sizeBytes < 1 || dto.sizeBytes > 10 * 1024 * 1024) throw new BadRequestException("Each image must be between 1 byte and 10 MB.");
    return this.media.createUpload(user.id, dto);
  }

  @Post("uploads/confirm")
  confirmUpload(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConfirmIdentityUploadDto) {
    return this.media.confirmUpload(user.id, dto.assetId);
  }

  @Post("uploads/failure")
  reportUploadFailure(@CurrentUser() _user: AuthenticatedUser, @Body() dto: IdentityUploadFailureDto) {
    this.media.logIdentityUploadFailure(dto);
    return { received: true };
  }

  @Get("status")
  async status(@CurrentUser() user: AuthenticatedUser) {
    const [account, latestCase, idFront, idBack, bookPage1, bookPage2, legacyId, selfie] = await Promise.all([
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
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_DOCUMENT_FRONT", status: "READY" }, orderBy: { uploadedAt: "desc" }, select: { id: true } }),
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_DOCUMENT_BACK", status: "READY" }, orderBy: { uploadedAt: "desc" }, select: { id: true } }),
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_BOOK_PAGE_1", status: "READY" }, orderBy: { uploadedAt: "desc" }, select: { id: true } }),
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_BOOK_PAGE_2", status: "READY" }, orderBy: { uploadedAt: "desc" }, select: { id: true } }),
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_DOCUMENT", status: "READY" }, orderBy: { uploadedAt: "desc" }, select: { id: true } }),
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_SELFIE", status: "READY" }, select: { id: true } }),
    ]);

    const [idFrontPreview, idBackPreview, bookPage1Preview, bookPage2Preview, selfiePreview] = await Promise.all([
      this.media.getIdentityPreviewUrl(user.id, "ID_DOCUMENT_FRONT"),
      this.media.getIdentityPreviewUrl(user.id, "ID_DOCUMENT_BACK"),
      this.media.getIdentityPreviewUrl(user.id, "ID_BOOK_PAGE_1"),
      this.media.getIdentityPreviewUrl(user.id, "ID_BOOK_PAGE_2"),
      this.media.getIdentityPreviewUrl(user.id, "ID_SELFIE"),
    ]);

    return {
      status: account.identityVerification.toLowerCase(),
      verifiedAt: account.identityVerifiedAt,
      latestCase,
      idDocumentUploaded: Boolean(idFront || idBack || bookPage1 || bookPage2 || legacyId),
      idType: bookPage1 || bookPage2 ? "GREEN_ID_BOOK" : idFront || idBack ? "SMART_ID_CARD" : null,
      idFrontUploaded: Boolean(idFront), idBackUploaded: Boolean(idBack),
      bookPage1Uploaded: Boolean(bookPage1), bookPage2Uploaded: Boolean(bookPage2),
      selfieUploaded: Boolean(selfie),
      previews: {
        ID_DOCUMENT_FRONT: idFrontPreview?.url ?? null,
        ID_DOCUMENT_BACK: idBackPreview?.url ?? null,
        ID_BOOK_PAGE_1: bookPage1Preview?.url ?? null,
        ID_BOOK_PAGE_2: bookPage2Preview?.url ?? null,
        ID_SELFIE: selfiePreview?.url ?? null,
      },
    };
  }

  @Post("submit")
  async submit(@CurrentUser() user: AuthenticatedUser, @Body() body: { idType?: string }) {
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

    const [front, back, page1, page2, legacy, selfie] = await Promise.all([
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_DOCUMENT_FRONT", status: "READY" }, orderBy: { uploadedAt: "desc" } }),
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_DOCUMENT_BACK", status: "READY" }, orderBy: { uploadedAt: "desc" } }),
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_BOOK_PAGE_1", status: "READY" }, orderBy: { uploadedAt: "desc" } }),
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_BOOK_PAGE_2", status: "READY" }, orderBy: { uploadedAt: "desc" } }),
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_DOCUMENT", status: "READY" }, orderBy: { uploadedAt: "desc" } }),
      this.prisma.mediaAsset.findFirst({ where: { userId: user.id, purpose: "ID_SELFIE", status: "READY" }, orderBy: { uploadedAt: "desc" } }),
    ]);
    const validId = body.idType === "SMART_ID_CARD" ? Boolean(front && back) : body.idType === "GREEN_ID_BOOK" ? Boolean(page1) : false;
    if (!validId || !selfie) throw new BadRequestException(body.idType === "GREEN_ID_BOOK" ? "Upload the Green ID book photo/details page and take a live selfie before submitting verification." : "Upload both sides of your Smart ID card and take a live selfie before submitting verification.");

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
        data: { userId: user.id, status: "SUBMITTED", provider: "MANUAL_REVIEW", providerReference: (body.idType === "SMART_ID_CARD" ? "type:SMART_ID_CARD;front:" + front!.id + ";back:" + back!.id : "type:GREEN_ID_BOOK;page1:" + page1!.id) + ";selfie:" + selfie.id },
        select: { id: true, status: true, submittedAt: true },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { identityVerification: "PENDING", identityVerifiedAt: null },
      });

      await tx.appNotification.create({
        data: {
          userId: user.id,
          title: "Profile submitted for verification",
          body: "Your profile and identity documents have been submitted. We'll notify you when the review is complete.",
          data: { type: "PROFILE_VERIFICATION_SUBMITTED", verificationCaseId: created.id },
        },
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
