import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { PrismaService } from "../database/prisma.service";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const FORMAT_MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const FOLDERS: Record<string, string> = { JOB_COMPLETION_EVIDENCE: "anyskill/job-completion-evidence", ID_DOCUMENT: "anyskill/identity-verification", ID_DOCUMENT_FRONT: "anyskill/identity-verification", ID_DOCUMENT_BACK: "anyskill/identity-verification", ID_BOOK_PAGE_1: "anyskill/identity-verification", ID_BOOK_PAGE_2: "anyskill/identity-verification", ID_SELFIE: "anyskill/identity-verification" };

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private configured = false;

  logIdentityUploadFailure(input: {
    purpose: string;
    stage: string;
    httpStatus?: number;
    errorCode?: string;
  }) {
    const details = [
      `purpose=${input.purpose}`,
      `stage=${input.stage}`,
      input.httpStatus ? `httpStatus=${input.httpStatus}` : undefined,
      input.errorCode ? `errorCode=${input.errorCode.slice(0, 80)}` : undefined,
    ].filter(Boolean).join(" ");
    this.logger.warn(`[identity-upload] ${details}`);
  }

  constructor(private readonly prisma: PrismaService) {
    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
    if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
      cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET, secure: true });
      this.configured = true;
    }
  }

  private ensureConfigured() {
    if (!this.configured) throw new ServiceUnavailableException("Photo uploads are not configured yet. Contact support.");
  }

  async createUpload(userId: string, input: { fileName: string; contentType: string; sizeBytes: number; purpose?: "JOB_COMPLETION_EVIDENCE" | "ID_DOCUMENT" | "ID_DOCUMENT_FRONT" | "ID_DOCUMENT_BACK" | "ID_BOOK_PAGE_1" | "ID_BOOK_PAGE_2" | "ID_SELFIE" }) {
    this.ensureConfigured();
    const purpose = input.purpose ?? "JOB_COMPLETION_EVIDENCE";
    const folder = FOLDERS[purpose];
    if (!folder) throw new BadRequestException("Unsupported upload purpose.");
    if (!ALLOWED.has(input.contentType)) throw new BadRequestException("Only JPEG, PNG and WebP images are accepted.");
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_BYTES) {
      throw new BadRequestException("Each image must be between 1 byte and 10 MB.");
    }

    const id = randomUUID();
    const publicId = `${userId}/${id}`;
    const asset = await this.prisma.mediaAsset.create({
      data: {
        userId,
        objectKey: `${folder}/${publicId}`,
        originalName: input.fileName.slice(0, 255),
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        purpose,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

    return { assetId: asset.id };
  }

  async uploadIdentityFile(userId: string, assetId: string, file: { buffer: Buffer; mimetype: string; size: number }) {
    this.ensureConfigured();
    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        userId,
        status: "PENDING",
        purpose: { in: ["ID_DOCUMENT_FRONT", "ID_DOCUMENT_BACK", "ID_BOOK_PAGE_1", "ID_BOOK_PAGE_2", "ID_SELFIE"] },
      },
    });
    if (!asset) throw new NotFoundException("Identity upload reservation not found.");
    if (!file?.buffer?.length) throw new BadRequestException("Choose an image before uploading.");
    if (file.size > MAX_BYTES || file.size !== asset.sizeBytes) throw new BadRequestException("The selected image size does not match its upload reservation.");
    if (!ALLOWED.has(file.mimetype) || file.mimetype !== asset.contentType) throw new BadRequestException("Only the reserved JPEG, PNG or WebP image can be uploaded.");

    const folder = FOLDERS[asset.purpose];
    if (!folder) throw new BadRequestException("Unsupported upload purpose.");
    const publicId = asset.objectKey.slice((folder + "/").length);
    await new Promise<void>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        resource_type: "image",
        type: "authenticated",
        public_id: publicId,
        // "folder" works in both Cloudinary folder modes. In fixed-folder
        // mode, "asset_folder" is ignored; in dynamic-folder mode, "folder"
        // also prefixes the public ID. Our database objectKey stores that
        // resulting full public ID.
        folder,
        overwrite: false,
        unique_filename: false,
        use_filename: false,
      }, (error) => {
        if (!error) {
          resolve();
          return;
        }

        // Cloudinary SDK errors are not always Error instances. Record only safe
        // diagnostic fields so the API log exposes the real failure instead of
        // the unhelpful "[object Object]" produced by generic exception logging.
        const details = typeof error === "object" && error !== null
          ? error as { message?: unknown; http_code?: unknown; code?: unknown; name?: unknown }
          : undefined;
        const errorMessage = typeof details?.message === "string"
          ? details.message
          : String(error);
        const httpStatus = typeof details?.http_code === "number" ? details.http_code : undefined;
        const errorCode = typeof details?.code === "string" ? details.code : undefined;
        this.logger.error(
          `[identity-upload] Cloudinary rejected upload purpose=${asset.purpose} httpStatus=${httpStatus ?? "unknown"} code=${errorCode ?? "unknown"} message=${errorMessage.slice(0, 500)}`,
        );
        reject(new InternalServerErrorException("The verification image could not be stored securely. Please try again."));
      });
      stream.on("error", (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[identity-upload] Cloudinary stream failed purpose=${asset.purpose} message=${message.slice(0, 500)}`);
        reject(new InternalServerErrorException("The verification image could not be stored securely. Please try again."));
      });
      stream.end(file.buffer);
    });
    return { received: true };
  }

  async confirmUpload(userId: string, assetId: string) {
    this.ensureConfigured();
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, userId, purpose: { in: ["JOB_COMPLETION_EVIDENCE", "ID_DOCUMENT", "ID_DOCUMENT_FRONT", "ID_DOCUMENT_BACK", "ID_BOOK_PAGE_1", "ID_BOOK_PAGE_2", "ID_SELFIE"] } },
    });
    if (!asset) throw new NotFoundException("Upload reservation not found.");
    if (asset.status === "READY") return { id: asset.id, status: asset.status };
    if (asset.status !== "PENDING") throw new ConflictException("Upload reservation is no longer available.");
    if (asset.expiresAt <= new Date()) {
      await this.prisma.mediaAsset.updateMany({ where: { id: asset.id, status: "PENDING" }, data: { status: "EXPIRED" } });
      throw new ConflictException("Upload reservation expired. Please upload the image again.");
    }

    const folder = FOLDERS[asset.purpose];
    if (!folder) throw new BadRequestException("Unsupported upload purpose.");
    // The upload uses Cloudinary's cross-mode "folder" parameter, so the
    // resulting public ID is the complete stored objectKey in both folder modes.
    const expectedPublicId = asset.objectKey;
    let remote: any;
    try {
      remote = await cloudinary.api.resource(expectedPublicId, { resource_type: "image", type: "authenticated" });
    } catch {
      throw new BadRequestException("Cloudinary has not received this image. Upload it and try again.");
    }

    const remoteMime = FORMAT_MIME[String(remote.format ?? "").toLowerCase()];
    const valid =
      remote.public_id === expectedPublicId &&
      (remote.asset_folder ?? remote.folder) === folder &&
      remoteMime === asset.contentType &&
      ALLOWED.has(remoteMime) &&
      remote.bytes === asset.sizeBytes &&
      remote.bytes <= MAX_BYTES &&
      remote.resource_type === "image" &&
      remote.type === "authenticated";

    if (!valid) {
      try {
        await cloudinary.uploader.destroy(expectedPublicId, {
          resource_type: "image",
          type: "authenticated",
          invalidate: true,
        });
      } catch {
        // Keep the reservation unusable even if Cloudinary cleanup is temporarily unavailable.
      }
      throw new BadRequestException("Uploaded image failed Cloudinary asset, folder, format, size or access validation.");
    }

    const updated = await this.prisma.mediaAsset.updateMany({
      where: { id: asset.id, userId, status: "PENDING", expiresAt: { gt: new Date() } },
      data: { status: "READY", uploadedAt: new Date() },
    });
    if (updated.count !== 1) {
      try {
        await cloudinary.uploader.destroy(expectedPublicId, { resource_type: "image", type: "authenticated", invalidate: true });
      } catch {}
      throw new ConflictException("Upload reservation is no longer valid.");
    }

    return { id: asset.id, status: "READY" };
  }

  async getIdentityPreviewUrl(userId: string, purpose: "ID_DOCUMENT_FRONT" | "ID_DOCUMENT_BACK" | "ID_BOOK_PAGE_1" | "ID_BOOK_PAGE_2" | "ID_SELFIE") {
    this.ensureConfigured();
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { userId, purpose, status: "READY" },
      orderBy: { uploadedAt: "desc" },
      select: { objectKey: true, contentType: true },
    });
    if (!asset) return null;
    const formatByMime: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const format = formatByMime[asset.contentType];
    const folder = FOLDERS[purpose];
    if (!format || !folder) throw new BadRequestException("Identity image has an unsupported format.");
    const publicId = asset.objectKey;
    const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;
    const url = cloudinary.utils.private_download_url(publicId, format, {
      resource_type: "image",
      type: "authenticated",
      expires_at: expiresAt,
      attachment: false,
    });
    return { url, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }

  async getEvidenceUrl(userId: string, assetId: string) {
    this.ensureConfigured();
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, status: "READY", completionSubmissionId: { not: null } },
      include: { completionSubmission: { include: { engagement: { select: { seekerId: true, providerId: true } } } } },
    });
    if (!asset || !asset.completionSubmission) throw new NotFoundException("Evidence image not found.");

    const job = asset.completionSubmission.engagement;
    if (job.seekerId !== userId && job.providerId !== userId) {
      throw new ForbiddenException("You are not allowed to view this evidence.");
    }

    const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;
    const formatByMime: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const format = formatByMime[asset.contentType];
    if (!format) throw new BadRequestException("Evidence image has an unsupported content type.");
    const folder = FOLDERS[asset.purpose];
    if (!folder) throw new BadRequestException("Evidence image has an unsupported purpose.");
    const publicId = asset.objectKey.slice((folder + "/").length);
    const url = cloudinary.utils.private_download_url(publicId, format, {
      resource_type: "image",
      type: "authenticated",
      expires_at: expiresAt,
      attachment: false,
    });
    return { url, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }
}
