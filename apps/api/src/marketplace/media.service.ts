import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { PrismaService } from "../database/prisma.service";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const FORMAT_MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const FOLDER = "anyskill/job-completion-evidence";

@Injectable()
export class MediaService {
  private configured = false;

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

  async createUpload(userId: string, input: { fileName: string; contentType: string; sizeBytes: number }) {
    this.ensureConfigured();
    if (!ALLOWED.has(input.contentType)) throw new BadRequestException("Only JPEG, PNG and WebP images are accepted.");
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_BYTES) {
      throw new BadRequestException("Each image must be between 1 byte and 10 MB.");
    }

    const id = randomUUID();
    const publicId = `${userId}/${id}`;
    const timestamp = Math.floor(Date.now() / 1000);
    // The REST endpoint /image/authenticated establishes the authenticated delivery type.
    // Sign every client-supplied upload parameter; never expose the API secret.
    const params = {
      timestamp,
      public_id: publicId,
      asset_folder: FOLDER,
      overwrite: false,
      unique_filename: false,
      use_filename: false,
    };
    const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET!);
    const asset = await this.prisma.mediaAsset.create({
      data: {
        userId,
        objectKey: `${FOLDER}/${publicId}`,
        originalName: input.fileName.slice(0, 255),
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        purpose: "JOB_COMPLETION_EVIDENCE",
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

    return {
      assetId: asset.id,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      timestamp,
      signature,
      publicId,
      assetFolder: FOLDER,
      maxBytes: MAX_BYTES,
    };
  }

  async confirmUpload(userId: string, assetId: string) {
    this.ensureConfigured();
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, userId, purpose: "JOB_COMPLETION_EVIDENCE" },
    });
    if (!asset) throw new NotFoundException("Upload reservation not found.");
    if (asset.status === "READY") return { id: asset.id, status: asset.status };
    if (asset.status !== "PENDING") throw new ConflictException("Upload reservation is no longer available.");
    if (asset.expiresAt <= new Date()) {
      await this.prisma.mediaAsset.updateMany({ where: { id: asset.id, status: "PENDING" }, data: { status: "EXPIRED" } });
      throw new ConflictException("Upload reservation expired. Please upload the image again.");
    }

    const expectedPublicId = asset.objectKey.slice((FOLDER + "/").length);
    let remote: any;
    try {
      remote = await cloudinary.api.resource(expectedPublicId, { resource_type: "image", type: "authenticated" });
    } catch {
      throw new BadRequestException("Cloudinary has not received this image. Upload it and try again.");
    }

    const remoteMime = FORMAT_MIME[String(remote.format ?? "").toLowerCase()];
    const valid =
      remote.public_id === expectedPublicId &&
      remote.asset_folder === FOLDER &&
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
    const format = asset.contentType === "image/jpeg" ? "jpg" : asset.contentType.split("/")[1];
    const publicId = asset.objectKey.slice((FOLDER + "/").length);
    const url = cloudinary.utils.private_download_url(publicId, format, {
      resource_type: "image",
      type: "authenticated",
      expires_at: expiresAt,
      attachment: false,
    });
    return { url, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }
}
