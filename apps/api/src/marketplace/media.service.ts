import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
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
  private cloudName = "";
  private apiKey = "";
  private apiSecret = "";

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
    // Prefer Cloudinary's canonical CLOUDINARY_URL (cloudinary://key:secret@cloud).
    // Keep the split variables as a backwards-compatible fallback for existing deployments.
    const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim();
    if (cloudinaryUrl) {
      try {
        const parsed = new URL(cloudinaryUrl);
        if (parsed.protocol === "cloudinary:") {
          this.cloudName = parsed.hostname.trim();
          this.apiKey = decodeURIComponent(parsed.username).trim();
          this.apiSecret = decodeURIComponent(parsed.password).trim();
        }
      } catch {
        this.logger.error("CLOUDINARY_URL is invalid. Expected cloudinary://<api_key>:<api_secret>@<cloud_name>.");
      }
    }

    this.cloudName ||= process.env.CLOUDINARY_CLOUD_NAME?.trim() ?? "";
    this.apiKey ||= process.env.CLOUDINARY_API_KEY?.trim() ?? "";
    this.apiSecret ||= process.env.CLOUDINARY_API_SECRET?.trim() ?? "";

    if (this.cloudName && this.apiKey && this.apiSecret) {
      cloudinary.config({
        cloud_name: this.cloudName,
        api_key: this.apiKey,
        api_secret: this.apiSecret,
        secure: true,
      });
      this.configured = true;
    } else if (cloudinaryUrl) {
      this.logger.error("Cloudinary is not configured. Check CLOUDINARY_URL credentials and cloud name.");
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
    const timestamp = Math.floor(Date.now() / 1000);
    // Sign the exact parameters the native app sends to Cloudinary. The API
    // secret never leaves the server; the signature is short-lived and scoped
    // to this user's reserved private identity asset.
    const params = {
      timestamp,
      public_id: publicId,
      folder,
      type: "authenticated",
      overwrite: false,
      unique_filename: false,
      use_filename: false,
    };
    const signature = cloudinary.utils.api_sign_request(params, this.apiSecret);
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

    return {
      assetId: asset.id,
      cloudName: this.cloudName,
      apiKey: this.apiKey,
      timestamp,
      signature,
      publicId,
      assetFolder: folder,
      maxBytes: MAX_BYTES,
    };
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
    // `folder` is signed and prepended to the public_id by Cloudinary in
    // fixed-folder mode. In dynamic-folder mode it also sets asset_folder.
    // objectKey stores the complete Cloudinary public_id in both modes.
    const expectedPublicId = asset.objectKey;
    let remote: any;
    try {
      remote = await cloudinary.api.resource(expectedPublicId, { resource_type: "image", type: "authenticated" });
    } catch {
      throw new BadRequestException("Cloudinary has not received this image. Upload it and try again.");
    }

    const remoteMime = FORMAT_MIME[String(remote.format ?? "").toLowerCase()];
    const checks = {
      publicIdMatches: remote.public_id === expectedPublicId,
      // Dynamic-folder accounts expose asset_folder as the configured folder.
      // Fixed-folder accounts expose the legacy folder path, which can include
      // the user-specific parent directory from the public ID.
      folderMatches: remote.asset_folder != null
        ? remote.asset_folder === folder
        : remote.folder === folder || remote.folder === asset.objectKey.slice(0, asset.objectKey.lastIndexOf("/")),
      formatMatches: remoteMime === asset.contentType,
      formatAllowed: Boolean(remoteMime && ALLOWED.has(remoteMime)),
      sizeMatches: remote.bytes === asset.sizeBytes,
      sizeWithinLimit: remote.bytes <= MAX_BYTES,
      resourceTypeIsImage: remote.resource_type === "image",
      deliveryTypeIsAuthenticated: remote.type === "authenticated",
    };
    const valid = Object.values(checks).every(Boolean);

    if (!valid) {
      // Log only Cloudinary metadata and pass/fail flags. Never log image bytes,
      // credentials, user IDs, or the full public ID.
      this.logger.error(
        `[identity-upload] Cloudinary confirmation validation failed purpose=${asset.purpose} ` +
        `checks=${JSON.stringify(checks)} ` +
        `expectedFolder=${folder} assetFolder=${String(remote.asset_folder ?? "missing")} ` +
        `legacyFolder=${String(remote.folder ?? "missing")} format=${String(remote.format ?? "missing")} ` +
        `expectedMime=${asset.contentType} bytes=${String(remote.bytes ?? "missing")} ` +
        `expectedBytes=${asset.sizeBytes} resourceType=${String(remote.resource_type ?? "missing")} ` +
        `deliveryType=${String(remote.type ?? "missing")}`,
      );
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

  private async resolveStoredPublicId(objectKey: string, folder: string) {
    // Older reservations used asset_folder, keeping the folder out of public_id.
    // Resolve those existing assets while new uploads use the full folder-prefixed ID.
    try {
      await cloudinary.api.resource(objectKey, { resource_type: "image", type: "authenticated" });
      return objectKey;
    } catch {
      return objectKey.slice((folder + "/").length);
    }
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
    const publicId = await this.resolveStoredPublicId(asset.objectKey, folder);
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
    const publicId = await this.resolveStoredPublicId(asset.objectKey, folder);
    const url = cloudinary.utils.private_download_url(publicId, format, {
      resource_type: "image",
      type: "authenticated",
      expires_at: expiresAt,
      attachment: false,
    });
    return { url, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }
}
