import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { PrismaService } from "../database/prisma.service";

const MAX_BYTES = 10 * 1024 * 1024;
const CLOUDINARY_API_TIMEOUT_MS = 15_000;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const FORMAT_MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const FOLDERS: Record<string, string> = { PROVIDER_QUALIFICATION: "anyskill/provider-qualifications", PROVIDER_PORTFOLIO_IMAGE: "anyskill/provider-portfolios", JOB_COMPLETION_EVIDENCE: "anyskill/job-completion-evidence", ID_DOCUMENT: "anyskill/identity-verification", ID_DOCUMENT_FRONT: "anyskill/identity-verification", ID_DOCUMENT_BACK: "anyskill/identity-verification", ID_BOOK_PAGE_1: "anyskill/identity-verification", ID_BOOK_PAGE_2: "anyskill/identity-verification", ID_SELFIE: "anyskill/identity-verification" };

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
        hide_sensitive: true,
      });
      this.configured = true;
    } else if (cloudinaryUrl) {
      this.logger.error("Cloudinary is not configured. Check CLOUDINARY_URL credentials and cloud name.");
    }
  }

  private ensureConfigured() {
    if (!this.configured) throw new ServiceUnavailableException("Photo uploads are not configured yet. Contact support.");
  }

  async createUpload(
    userId: string,
    input: { fileName: string; contentType: string; sizeBytes: number; purpose?: "JOB_COMPLETION_EVIDENCE" | "ID_DOCUMENT" | "ID_DOCUMENT_FRONT" | "ID_DOCUMENT_BACK" | "ID_BOOK_PAGE_1" | "ID_BOOK_PAGE_2" | "ID_SELFIE" | "PROVIDER_QUALIFICATION" | "PROVIDER_PORTFOLIO_IMAGE" },
    idempotencyKey?: string,
  ) {
    this.ensureConfigured();
    const purpose = input.purpose ?? "JOB_COMPLETION_EVIDENCE";
    const folder = FOLDERS[purpose];
    if (!folder) throw new BadRequestException("Unsupported upload purpose.");
    if (!ALLOWED.has(input.contentType)) throw new BadRequestException("Only JPEG, PNG and WebP images are accepted.");
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_BYTES) {
      throw new BadRequestException("Each image must be between 1 byte and 10 MB.");
    }
    if (idempotencyKey != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      throw new BadRequestException("Idempotency-Key must be a valid UUID.");
    }

    const payloadHash = createHash("sha256").update(JSON.stringify({
      fileName: input.fileName.slice(0, 255), contentType: input.contentType, sizeBytes: input.sizeBytes, purpose,
    })).digest("hex");
    let asset;
    try {
      asset = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('provider-eligibility'), hashtext(${userId}))`;
        const account = await tx.user.findUnique({
          where: { id: userId },
          select: { deletedAt: true, seekerRoleStatus: true, providerRoleStatus: true },
        });
        if (!account || account.deletedAt !== null ||
            (account.seekerRoleStatus === "SUSPENDED" && account.providerRoleStatus === "SUSPENDED")) {
          throw new ForbiddenException("This account is not active for new uploads.");
        }

        const existing = idempotencyKey
          ? await tx.mediaAsset.findFirst({ where: { userId, idempotencyKey } })
          : null;
        if (existing) {
          if (existing.idempotencyPayloadHash !== payloadHash) {
            throw new ConflictException("This Idempotency-Key was already used with a different upload.");
          }
          if (existing.status === "READY") return existing;
          if (existing.status === "VERIFYING") throw new ConflictException("This upload is already being verified. Please retry shortly.");
          if (existing.status !== "PENDING" || existing.expiresAt <= new Date()) {
            throw new ConflictException("This upload reservation has expired. Start a new upload.");
          }
          return existing;
        }

        return tx.mediaAsset.create({
          data: {
            userId,
            ...(idempotencyKey ? { idempotencyKey, idempotencyPayloadHash: payloadHash } : {}),
            objectKey: `${folder}/${userId}/${randomUUID()}`,
            originalName: input.fileName.slice(0, 255),
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
            purpose,
            expiresAt: new Date(Date.now() + 30 * 60_000),
          },
        });
      });
    } catch (error) {
      const isUniqueConflict = Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
      if (!idempotencyKey || !isUniqueConflict) throw error;
      const [account, existing] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { deletedAt: true, seekerRoleStatus: true, providerRoleStatus: true },
        }),
        this.prisma.mediaAsset.findFirst({ where: { userId, idempotencyKey } }),
      ]);
      if (!account || account.deletedAt !== null ||
          (account.seekerRoleStatus === "SUSPENDED" && account.providerRoleStatus === "SUSPENDED")) {
        throw new ForbiddenException("This account is not active for new uploads.");
      }
      if (!existing || existing.idempotencyPayloadHash !== payloadHash) {
        throw new ConflictException("This Idempotency-Key was already used with a different upload.");
      }
      if (existing.status === "READY") asset = existing;
      else if (existing.status === "PENDING" && existing.expiresAt > new Date()) asset = existing;
      else throw new ConflictException("This upload reservation is not available for retry.");
    }

    const publicId = asset.objectKey.slice(folder.length + 1);
    const timestamp = Math.floor(Date.now() / 1000);
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
    return {
      assetId: asset.id,
      cloudName: this.cloudName,
      apiKey: this.apiKey,
      timestamp,
      signature,
      publicId,
      assetFolder: folder,
      maxBytes: MAX_BYTES,
      alreadyUploaded: asset.status === "READY",
    };
  }

  async confirmUpload(userId: string, assetId: string) {
    this.ensureConfigured();
    const outcome = await this.prisma.$transaction(async (tx) => {
      // Hold the same account lock used by deletion and upload reservation
      // creation throughout remote verification, so a file cannot become READY
      // after its owner has entered account deletion.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('provider-eligibility'), hashtext(${userId}))`;
      const account = await tx.user.findUnique({
        where: { id: userId },
        select: { deletedAt: true, seekerRoleStatus: true, providerRoleStatus: true },
      });
      if (!account || account.deletedAt !== null ||
          (account.seekerRoleStatus === "SUSPENDED" && account.providerRoleStatus === "SUSPENDED")) {
        return { ok: false as const, error: "inactive" as const };
      }

      const asset = await tx.mediaAsset.findFirst({
        where: { id: assetId, userId, purpose: { in: ["JOB_COMPLETION_EVIDENCE", "ID_DOCUMENT", "ID_DOCUMENT_FRONT", "ID_DOCUMENT_BACK", "ID_BOOK_PAGE_1", "ID_BOOK_PAGE_2", "ID_SELFIE", "PROVIDER_QUALIFICATION", "PROVIDER_PORTFOLIO_IMAGE"] } },
      });
      if (!asset) return { ok: false as const, error: "not-found" as const };
      if (asset.status === "READY") return { ok: true as const, id: asset.id, status: "READY" as const };

      const now = new Date();
      if (asset.expiresAt <= now) {
        await tx.mediaAsset.updateMany({
          where: { id: asset.id, userId, status: { in: ["PENDING", "VERIFYING"] }, expiresAt: { lte: now } },
          data: { status: "EXPIRED", verificationStartedAt: null },
        });
        return { ok: false as const, error: "expired" as const };
      }

      const staleClaimBefore = new Date(now.getTime() - 5 * 60_000);
      const claim = await tx.mediaAsset.updateMany({
        where: {
          id: asset.id,
          userId,
          expiresAt: { gt: now },
          OR: [
            { status: "PENDING" },
            { status: "VERIFYING", verificationStartedAt: { lt: staleClaimBefore } },
          ],
        },
        data: { status: "VERIFYING", verificationStartedAt: now },
      });
      if (claim.count !== 1) {
        const current = await tx.mediaAsset.findFirst({ where: { id: asset.id, userId }, select: { status: true } });
        if (current?.status === "READY") return { ok: true as const, id: asset.id, status: "READY" as const };
        return { ok: false as const, error: "verifying" as const };
      }

      const folder = FOLDERS[asset.purpose];
      if (!folder) {
        await tx.mediaAsset.updateMany({
          where: { id: asset.id, userId, status: "VERIFYING", verificationStartedAt: now },
          data: { status: "EXPIRED", verificationStartedAt: null },
        });
        return { ok: false as const, error: "unsupported" as const };
      }

      const expectedPublicId = asset.objectKey;
      let remote: any;
      try {
        remote = await cloudinary.api.resource(expectedPublicId, {
          resource_type: "image",
          type: "authenticated",
          timeout: CLOUDINARY_API_TIMEOUT_MS,
        });
      } catch (error) {
        const httpCode = error && typeof error === "object" && "http_code" in error
          ? Number((error as { http_code?: unknown }).http_code)
          : undefined;
        if (httpCode === 404) {
          await tx.mediaAsset.updateMany({
            where: { id: asset.id, userId, status: "VERIFYING", verificationStartedAt: now },
            data: { status: "EXPIRED", verificationStartedAt: null },
          });
          return { ok: false as const, error: "not-uploaded" as const };
        }

        // A timeout, rate limit, authentication outage, or 5xx is not proof
        // that the upload is absent. Release our verification lease so the
        // caller can retry without forcing a new upload reservation.
        await tx.mediaAsset.updateMany({
          where: { id: asset.id, userId, status: "VERIFYING", verificationStartedAt: now },
          data: { status: "PENDING", verificationStartedAt: null },
        });
        this.logger.warn(
          `[media-upload] Cloudinary verification temporarily unavailable purpose=${asset.purpose} ` +
          `httpStatus=${httpCode ?? "unknown"}`,
        );
        return { ok: false as const, error: "verification-unavailable" as const };
      }

      const remoteMime = FORMAT_MIME[String(remote.format ?? "").toLowerCase()];
      const checks = {
        publicIdMatches: remote.public_id === expectedPublicId,
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
      if (!Object.values(checks).every(Boolean)) {
        this.logger.error(
          `[media-upload] Cloudinary confirmation validation failed purpose=${asset.purpose} ` +
          `checks=${JSON.stringify(checks)} expectedFolder=${folder} ` +
          `assetFolder=${String(remote.asset_folder ?? "missing")} legacyFolder=${String(remote.folder ?? "missing")} ` +
          `format=${String(remote.format ?? "missing")} expectedMime=${asset.contentType} ` +
          `bytes=${String(remote.bytes ?? "missing")} expectedBytes=${asset.sizeBytes} ` +
          `resourceType=${String(remote.resource_type ?? "missing")} deliveryType=${String(remote.type ?? "missing")}`,
        );
        await tx.mediaAsset.updateMany({
          where: { id: asset.id, userId, status: "VERIFYING", verificationStartedAt: now },
          data: { status: "EXPIRED", verificationStartedAt: null },
        });
        try {
          const destroyOptions = {
            resource_type: "image" as const,
            type: "authenticated" as const,
            invalidate: true,
            timeout: CLOUDINARY_API_TIMEOUT_MS,
          };
          await cloudinary.uploader.destroy(expectedPublicId, destroyOptions as {
            resource_type?: "image";
            type?: "authenticated";
            invalidate?: boolean;
          });
        } catch {
          // The asset is unusable in the database even if remote cleanup is delayed.
        }
        return { ok: false as const, error: "invalid" as const };
      }

      const updated = await tx.mediaAsset.updateMany({
        where: { id: asset.id, userId, status: "VERIFYING", verificationStartedAt: now, expiresAt: { gt: new Date() } },
        data: { status: "READY", uploadedAt: new Date(), verificationStartedAt: null },
      });
      if (updated.count !== 1) {
        const current = await tx.mediaAsset.findFirst({ where: { id: asset.id, userId }, select: { status: true } });
        if (current?.status === "READY") return { ok: true as const, id: asset.id, status: "READY" as const };
        return { ok: false as const, error: "lease-expired" as const };
      }
      return { ok: true as const, id: asset.id, status: "READY" as const };
    }, { maxWait: 10_000, timeout: 60_000 });

    if (outcome.ok) return { id: outcome.id, status: outcome.status };
    switch (outcome.error) {
      case "inactive": throw new ForbiddenException("This account is not active for upload confirmation.");
      case "not-found": throw new NotFoundException("Upload reservation not found.");
      case "expired": throw new ConflictException("Upload reservation expired. Please upload the image again.");
      case "verifying": throw new ConflictException("This upload is already being verified. Please retry shortly.");
      case "unsupported": throw new BadRequestException("Unsupported upload purpose.");
      case "not-uploaded": throw new BadRequestException("Cloudinary has not received this image. Upload it and try again.");
      case "verification-unavailable": throw new ServiceUnavailableException("Image verification is temporarily unavailable. Retry confirmation shortly; you do not need to upload the image again.");
      case "invalid": throw new BadRequestException("Uploaded image failed Cloudinary asset, folder, format, size or access validation.");
      case "lease-expired": throw new ConflictException("Upload verification lease expired. Please confirm the upload again.");
    }
  }

  private async resolveStoredPublicId(objectKey: string, folder: string) {
    // Older reservations used asset_folder, keeping the folder out of public_id.
    // Resolve those existing assets while new uploads use the full folder-prefixed ID.
    try {
      await cloudinary.api.resource(objectKey, { resource_type: "image", type: "authenticated", timeout: CLOUDINARY_API_TIMEOUT_MS });
      return objectKey;
    } catch {
      return objectKey.slice((folder + "/").length);
    }
  }

  async getProviderEvidencePreviewUrl(userId: string, assetId: string) {
    this.ensureConfigured();
    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        userId,
        status: "READY",
        purpose: { in: ["PROVIDER_QUALIFICATION", "PROVIDER_PORTFOLIO_IMAGE"] },
      },
      select: { objectKey: true, contentType: true, purpose: true },
    });
    if (!asset) return null;
    const formatByMime: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const format = formatByMime[asset.contentType];
    const folder = FOLDERS[asset.purpose];
    if (!format || !folder) return null;
    const publicId = await this.resolveStoredPublicId(asset.objectKey, folder);
    const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;
    const url = cloudinary.utils.private_download_url(publicId, format, {
      resource_type: "image", type: "authenticated", expires_at: expiresAt, attachment: false,
    });
    return { url, expiresAt: new Date(expiresAt * 1000).toISOString() };
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
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    const url = cloudinary.utils.private_download_url(publicId, format, {
      resource_type: "image",
      type: "authenticated",
      expires_at: expiresAt,
      attachment: false,
    });
    return { url, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }

  async getIdentityImageBytes(userId: string, purpose: "ID_DOCUMENT_FRONT" | "ID_DOCUMENT_BACK" | "ID_BOOK_PAGE_1" | "ID_BOOK_PAGE_2" | "ID_SELFIE"): Promise<{ bytes: Buffer; contentType: string }> {
    this.ensureConfigured();
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { userId, purpose, status: "READY" },
      orderBy: { uploadedAt: "desc" },
      select: { objectKey: true, contentType: true, sizeBytes: true },
    });
    if (!asset) throw new NotFoundException("Identity document not found.");
    const formatByMime: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const format = formatByMime[asset.contentType];
    if (!format || asset.sizeBytes < 1 || asset.sizeBytes > MAX_BYTES) throw new BadRequestException("Identity document has an unsupported format or size.");
    const folder = FOLDERS[purpose];
    if (!folder) throw new BadRequestException("Identity document purpose is not supported.");
    const publicId = await this.resolveStoredPublicId(asset.objectKey, folder);
    const expiresAt = Math.floor(Date.now() / 1000) + 30;
    const url = cloudinary.utils.private_download_url(publicId, format, { resource_type: "image", type: "authenticated", expires_at: expiresAt, attachment: false });
    const response = await fetch(url, { signal: AbortSignal.timeout(CLOUDINARY_API_TIMEOUT_MS), redirect: "error" });
    if (!response.ok) throw new ServiceUnavailableException("Identity document storage is temporarily unavailable.");
    const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase();
    if (contentType !== asset.contentType) throw new ServiceUnavailableException("Identity document storage returned an unexpected file type.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1 || bytes.length > MAX_BYTES || bytes.length !== asset.sizeBytes) throw new ServiceUnavailableException("Identity document failed integrity validation.");
    return { bytes, contentType };
  }

  async cleanupExpiredReservations() {
    const now = new Date();
    const staleVerificationBefore = new Date(now.getTime() - 5 * 60_000);
    await this.prisma.mediaAsset.updateMany({
      where: {
        status: "VERIFYING",
        expiresAt: { lte: now },
        verificationStartedAt: { lt: staleVerificationBefore },
      },
      data: { status: "PENDING", verificationStartedAt: null },
    });
    const expired = await this.prisma.mediaAsset.findMany({
      where: { status: { in: ["PENDING", "EXPIRED"] }, expiresAt: { lte: now } },
      orderBy: { expiresAt: "asc" },
      take: 5,
      select: { id: true, objectKey: true, purpose: true, status: true },
    });
    if (expired.length === 0) return 0;
    this.ensureConfigured();

    let cleaned = 0;
    for (let offset = 0; offset < expired.length; offset += 5) {
      const batch = expired.slice(offset, offset + 5);
      const results = await Promise.allSettled(batch.map(async (asset) => {
        const folder = FOLDERS[asset.purpose];
        if (!folder) {
          this.logger.error(`Expired media reservation ${asset.id} has an unsupported purpose; leaving it for manual cleanup.`);
          return false;
        }
        const publicId = await this.resolveStoredPublicId(asset.objectKey, folder);
        const destroyOptions = {
          resource_type: "image" as const,
          type: "authenticated" as const,
          invalidate: true,
          timeout: CLOUDINARY_API_TIMEOUT_MS,
        };
        const result = await cloudinary.uploader.destroy(publicId, destroyOptions as {
          resource_type?: "image";
          type?: "authenticated";
          invalidate?: boolean;
        });
        if (result.result !== "ok" && result.result !== "not found") {
          throw new Error("Cloudinary did not confirm expired asset deletion.");
        }
        const removed = await this.prisma.mediaAsset.deleteMany({
          where: { id: asset.id, status: asset.status, expiresAt: { lte: now } },
        });
        return removed.count === 1;
      }));
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) cleaned += 1;
        if (result.status === "rejected") {
          this.logger.warn("Expired media reservation cleanup failed; it will be retried.");
        }
      }
    }
    return cleaned;
  }

  async deleteUserAssets(userId: string) {
    const assets = await this.prisma.mediaAsset.findMany({
      where: { userId },
      select: { objectKey: true, purpose: true },
    });
    if (assets.length === 0) return;
    this.ensureConfigured();

    // Bound concurrency to avoid both a long serial deletion and an
    // unbounded burst against Cloudinary. Failed batches abort account deletion;
    // already-deleted assets are safe to retry because "not found" is accepted.
    for (let offset = 0; offset < assets.length; offset += 5) {
      const batch = assets.slice(offset, offset + 5);
      const results = await Promise.allSettled(batch.map(async (asset) => {
        const folder = FOLDERS[asset.purpose];
        if (!folder) {
          throw new ServiceUnavailableException("An uploaded file could not be securely removed. Please contact support.");
        }
        const publicId = await this.resolveStoredPublicId(asset.objectKey, folder);
        const destroyOptions = {
          resource_type: "image" as const,
          type: "authenticated" as const,
          invalidate: true,
          timeout: CLOUDINARY_API_TIMEOUT_MS,
        };
        const result = await cloudinary.uploader.destroy(publicId, destroyOptions as {
          resource_type?: "image";
          type?: "authenticated";
          invalidate?: boolean;
        });
        if (result.result !== "ok" && result.result !== "not found") {
          throw new ServiceUnavailableException("Uploaded files could not be securely removed. Please try again later.");
        }
      }));
      if (results.some((result) => result.status === "rejected")) {
        throw new ServiceUnavailableException("Uploaded files could not be securely removed. Please try again later.");
      }
    }

    await this.prisma.mediaAsset.deleteMany({ where: { userId } });
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
