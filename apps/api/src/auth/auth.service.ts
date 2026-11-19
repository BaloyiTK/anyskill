import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { PrismaService } from "../database/prisma.service";
import { MailService } from "../mail/mail.service";
import { MediaService } from "../marketplace/media.service";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const RESET_OTP_TTL_MS = 10 * 60 * 1000;
const RESET_OTP_RESEND_MS = 60 * 1000;
const googleOAuthClient = new OAuth2Client();

function opaqueToken(): string {
  return randomBytes(48).toString("base64url");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly media: MediaService,
  ) {}

  private passwordResetOtpHash(email: string, otp: string): string {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) throw new Error("JWT_ACCESS_SECRET must be configured.");
    return createHmac("sha256", secret).update(`password-reset:${email.toLowerCase()}:${otp}`).digest("hex");
  }

  private registrationOtpHash(email: string, otp: string): string {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) throw new Error("JWT_ACCESS_SECRET must be configured.");
    return createHmac("sha256", secret).update(`${email.toLowerCase()}:${otp}`).digest("hex");
  }

  async register(input: { email: string; mode?: "SEEKER" | "PROVIDER" }) {
    const email = input.email.trim().toLowerCase();
    const genericResponse = {
      otpSent: true,
      expiresInSeconds: 600,
      resendAfterSeconds: 60,
      message: "If this email address can be registered, a verification code will be sent. If you already have an account, sign in instead.",
    };

    // Keep the response identical for existing accounts and new registrations.
    const existingUser = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) return genericResponse;

    const now = new Date();
    const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const otpHash = this.registrationOtpHash(email, otp);
    const expiresAt = new Date(now.getTime() + 600000);
    const resendAvailableAt = new Date(now.getTime() + 60000);
    let pendingId: string;

    try {
      const created = await this.prisma.pendingRegistration.create({
        data: { email, mode: input.mode ?? "SEEKER", otpHash, expiresAt, resendAvailableAt },
        select: { id: true },
      });
      pendingId = created.id;
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
      const previous = await this.prisma.pendingRegistration.findUnique({ where: { email } });
      if (!previous) return genericResponse;
      if (previous.verifiedAt) throw new ConflictException("Email verification is already complete. Continue registration.");
      if (previous.resendAvailableAt > now) throw new ConflictException("A code was sent recently. Please wait before requesting another.");
      const updated = await this.prisma.pendingRegistration.updateMany({
        where: { id: previous.id, verifiedAt: null, resendAvailableAt: { lte: now } },
        data: {
          mode: input.mode ?? "SEEKER", otpHash, attempts: 0, expiresAt, resendAvailableAt,
          registrationTokenHash: null, registrationTokenExpiresAt: null,
        },
      });
      if (updated.count !== 1) throw new ConflictException("A code was just requested. Please wait before trying again.");
      pendingId = previous.id;
    }

    try {
      await this.mail.sendRegistrationOtp(email, otp);
    } catch (error) {
      await this.prisma.pendingRegistration.updateMany({
        where: { id: pendingId, otpHash, verifiedAt: null },
        data: { resendAvailableAt: new Date() },
      });
      throw error;
    }
    return genericResponse;
  }

  async resendRegistrationOtp(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    const genericResponse = {
      otpSent: true,
      expiresInSeconds: 600,
      resendAfterSeconds: 60,
      message: "If a registration is pending for this email address, a verification code will be sent. If you already have an account, sign in instead.",
    };
    const existingUser = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) return genericResponse;

    const pending = await this.prisma.pendingRegistration.findUnique({ where: { email } });
    const now = new Date();
    if (!pending || pending.verifiedAt) return genericResponse;
    if (pending.resendAvailableAt > now) {
      const retryAfterSeconds = Math.ceil((pending.resendAvailableAt.getTime() - now.getTime()) / 1000);
      throw new ConflictException(`Please wait ${retryAfterSeconds} seconds before requesting another code.`);
    }

    const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const updated = await this.prisma.pendingRegistration.updateMany({
      where: { id: pending.id, verifiedAt: null, resendAvailableAt: { lte: now } },
      data: {
        otpHash: this.registrationOtpHash(email, otp),
        attempts: 0,
        expiresAt: new Date(now.getTime() + 600000),
        resendAvailableAt: new Date(now.getTime() + 60000),
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException("A code was just requested. Please wait before trying again.");
    }

    try {
      await this.mail.sendRegistrationOtp(email, otp);
    } catch (error) {
      // A failed email delivery must not lock the user out for another minute.
      await this.prisma.pendingRegistration.updateMany({
        where: { id: pending.id, verifiedAt: null },
        data: { resendAvailableAt: new Date() },
      });
      throw error;
    }

    return {
      otpSent: true,
      expiresInSeconds: 600,
      resendAfterSeconds: 60,
      message: "A new six-digit verification code has been sent to your email address.",
    };
  }

  async verifyRegistrationOtp(emailInput: string, otp: string) {
    const email=emailInput.trim().toLowerCase(); const now=new Date();
    const row=await this.prisma.pendingRegistration.findUnique({where:{email}});
    if(!row || row.verifiedAt || row.expiresAt<=now || row.attempts>=5) throw new UnauthorizedException("The code is invalid, expired or locked. Request a new code.");
    const expected=Buffer.from(row.otpHash,"hex"), actual=Buffer.from(this.registrationOtpHash(email,otp),"hex");
    if(expected.length!==actual.length || !timingSafeEqual(expected,actual)) {
      await this.prisma.pendingRegistration.updateMany({where:{id:row.id,verifiedAt:null,attempts:{lt:5}},data:{attempts:{increment:1}}});
      throw new UnauthorizedException("The code is invalid, expired or locked. Request a new code.");
    }
    const registrationToken=opaqueToken();
    const consumed=await this.prisma.pendingRegistration.updateMany({where:{id:row.id,verifiedAt:null,expiresAt:{gt:now},attempts:{lt:5}},data:{verifiedAt:now,registrationTokenHash:tokenHash(registrationToken),registrationTokenExpiresAt:new Date(now.getTime()+900000)}});
    if(consumed.count!==1) throw new UnauthorizedException("The verification code has already been used.");
    return {verified:true,registrationToken,expiresInSeconds:900};
  }

  async completeRegistration(registrationToken:string,password:string) {
    const hash=tokenHash(registrationToken), now=new Date();
    const row=await this.prisma.pendingRegistration.findUnique({where:{registrationTokenHash:hash}});
    if(!row?.verifiedAt || !row.registrationTokenExpiresAt || row.registrationTokenExpiresAt<=now) throw new UnauthorizedException("Registration session expired. Verify your email again.");
    const passwordHash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
    try {
      const user=await this.prisma.$transaction(async tx=>{
        const used=await tx.pendingRegistration.updateMany({where:{id:row.id,registrationTokenHash:hash,registrationTokenExpiresAt:{gt:now}},data:{registrationTokenHash:null,registrationTokenExpiresAt:null}});
        if(used.count!==1) throw new UnauthorizedException("Registration session has already been used.");
        const created=await tx.user.create({data:{email:row.email,passwordHash,emailVerifiedAt:now,initialMode:row.mode,seekerRoleStatus:row.mode === "SEEKER" ? "ACTIVE" : "NOT_REQUESTED",providerRoleStatus:"NOT_REQUESTED",activeMarketplaceMode:row.mode === "SEEKER" ? "SEEKER" : null},select:{id:true,email:true,createdAt:true}});
        await tx.pendingRegistration.delete({where:{id:row.id}}); return created;
      });
      return {user,...await this.issueTokens(user.id,user.email)};
    } catch(error) { if(typeof error==="object" && error!==null && "code" in error && error.code==="P2002") throw new ConflictException("An account with this email already exists."); throw error; }
  }

  async verifyEmail(token: string) {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: true },
    });

    if (!record || record.consumedAt || record.expiresAt <= new Date()) {
      throw new UnauthorizedException("The email verification link is invalid or expired");
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailVerificationToken.updateMany({
        where: { id: record.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException("The email verification link has already been used");
      }

      await tx.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: record.user.emailVerifiedAt ?? now },
      });

      await tx.appNotification.create({
        data: {
          userId: record.userId,
          title: "Email address verified",
          body: "Your AnySkill email address has been successfully verified.",
          data: { type: "ACCOUNT_EMAIL_VERIFIED" },
        },
      });
    });

    return { emailVerified: true };
  }

  private async verifyGoogleIdToken(idToken: string) {
    // Always trust the configured web client used for the authorization-code
    // exchange, even when the optional multi-client allowlist is not populated.
    const audiences = [...new Set([
      ...(process.env.GOOGLE_OAUTH_CLIENT_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      process.env.GOOGLE_WEB_CLIENT_ID?.trim(),
    ].filter((value): value is string => Boolean(value)))];

    if (audiences.length === 0) {
      throw new Error("Google sign-in is not configured. Set GOOGLE_OAUTH_CLIENT_IDS.");
    }

    try {
      const ticket = await googleOAuthClient.verifyIdToken({
        idToken,
        audience: audiences,
      });
      const payload = ticket.getPayload();

      if (!payload?.sub || !payload.email || payload.email_verified !== true) {
        throw new UnauthorizedException("Google did not provide a verified email address");
      }

      return {
        subject: payload.sub,
        email: payload.email.trim().toLowerCase(),
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException("Google sign-in token is invalid or expired");
    }
  }

  private async exchangeGoogleAuthorizationCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<string> {
    const configuredWebClientId = process.env.GOOGLE_WEB_CLIENT_ID?.trim();
    const firstAllowedClientId = (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .find(Boolean);
    const webClientId = configuredWebClientId || firstAllowedClientId;

    if (!webClientId) {
      throw new Error("Google web sign-in is not configured. Set GOOGLE_WEB_CLIENT_ID.");
    }

    const allowedRedirectUris = (process.env.GOOGLE_WEB_REDIRECT_URIS ?? "http://localhost:8081")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!allowedRedirectUris.includes(redirectUri)) {
      throw new UnauthorizedException("Google sign-in redirect URI is not allowed.");
    }

    try {
      // Exchange the PKCE authorization code on the server, not in the browser.
      // The verifier is short-lived and is never persisted by the API.
      const oauthClient = new OAuth2Client(
        webClientId,
        process.env.GOOGLE_WEB_CLIENT_SECRET?.trim() || undefined,
      );
      const { tokens } = await oauthClient.getToken({
        code,
        codeVerifier,
        redirect_uri: redirectUri,
      });

      if (!tokens.id_token) {
        throw new UnauthorizedException("Google did not return an ID token.");
      }

      return tokens.id_token;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;

      // Log only Google's structured error metadata. Never log the authorization
      // code, PKCE verifier, tokens, client secret, or the full request object.
      const providerResponse = (error as {
        response?: { status?: number; data?: unknown };
      }).response;
      const providerData = providerResponse?.data;
      const providerError = typeof providerData === "object" && providerData !== null
        ? providerData as { error?: unknown; error_description?: unknown }
        : undefined;
      const providerCode = typeof providerError?.error === "string"
        ? providerError.error
        : "unknown";
      const providerDescription = typeof providerError?.error_description === "string"
        ? providerError.error_description.slice(0, 240)
        : "No provider description";
      this.logger.warn(
        `Google authorization-code exchange failed (HTTP ${providerResponse?.status ?? "unknown"}; ${providerCode}): ${providerDescription}`,
      );
      throw new UnauthorizedException("Google sign-in could not be completed. Check the API log for the provider error and try again.");
    }
  }

  async googleSignInWithAuthorizationCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
    mode?: "SEEKER" | "PROVIDER",
  ) {
    const idToken = await this.exchangeGoogleAuthorizationCode(code, codeVerifier, redirectUri);
    return this.googleSignIn(idToken, mode);
  }

  async linkGoogleAccountWithAuthorizationCode(
    userId: string,
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ) {
    const idToken = await this.exchangeGoogleAuthorizationCode(code, codeVerifier, redirectUri);
    return this.linkGoogleAccount(userId, idToken);
  }

  async googleSignIn(idToken: string, mode: "SEEKER" | "PROVIDER" = "SEEKER") {
    const google = await this.verifyGoogleIdToken(idToken);
    const linkedUser = await this.prisma.user.findUnique({
      where: { googleSubject: google.subject },
    });

    if (linkedUser) {
      return this.issueTokens(linkedUser.id, linkedUser.email);
    }

    const existingEmail = await this.prisma.user.findUnique({
      where: { email: google.email },
    });

    if (existingEmail) {
      // Google has already verified ownership of this exact email address.
      // Attach the Google subject to the existing account instead of creating
      // a duplicate or forcing the user through a separate password login.
      if (existingEmail.googleSubject === google.subject) {
        return this.issueTokens(existingEmail.id, existingEmail.email);
      }

      if (existingEmail.googleSubject) {
        throw new ConflictException(
          "This Google account is already linked to another AnySkill account.",
        );
      }

      const linked = await this.prisma.user.updateMany({
        where: { id: existingEmail.id, googleSubject: null },
        data: {
          googleSubject: google.subject,
          emailVerifiedAt: existingEmail.emailVerifiedAt ?? new Date(),
        },
      });

      if (linked.count === 1) {
        return this.issueTokens(existingEmail.id, existingEmail.email);
      }

      // Handle a concurrent sign-in/link attempt without overwriting another
      // Google identity or creating a second user for the same email.
      const refreshedUser = await this.prisma.user.findUnique({
        where: { id: existingEmail.id },
      });
      if (refreshedUser?.googleSubject === google.subject) {
        return this.issueTokens(refreshedUser.id, refreshedUser.email);
      }

      throw new ConflictException(
        "This Google account is already linked to another AnySkill account.",
      );
    }

    const generatedPassword = randomBytes(48).toString("base64url");
    const passwordHash = await argon2.hash(generatedPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    try {
      const user = await this.prisma.user.create({
        data: {
          email: google.email,
          passwordHash,
          googleSubject: google.subject,
          emailVerifiedAt: new Date(),
          initialMode: mode,
          seekerRoleStatus: mode === "SEEKER" ? "ACTIVE" : "NOT_REQUESTED",
          providerRoleStatus: "NOT_REQUESTED",
          activeMarketplaceMode: mode === "SEEKER" ? "SEEKER" : null,
        },
        select: { id: true, email: true },
      });

      return this.issueTokens(user.id, user.email);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new ConflictException("This Google account or email is already registered. Sign in instead.");
      }
      throw error;
    }
  }

  async linkGoogleAccount(userId: string, idToken: string) {
    const google = await this.verifyGoogleIdToken(idToken);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.emailVerifiedAt) {
      throw new UnauthorizedException("A verified AnySkill account is required");
    }
    if (user.email.toLowerCase() !== google.email) {
      throw new ConflictException("The Google email must match your AnySkill account email");
    }

    const existingGoogleAccount = await this.prisma.user.findUnique({
      where: { googleSubject: google.subject },
    });
    if (existingGoogleAccount && existingGoogleAccount.id !== userId) {
      throw new ConflictException("This Google account is already linked to another AnySkill account");
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { googleSubject: google.subject },
    });

    return { linked: true };
  }

  async login(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException("Email or password is incorrect");
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException("Verify your email address before signing in");
    }

    return this.issueTokens(user.id, user.email);
  }

  private async issueTokens(userId: string, email: string) {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error("JWT_ACCESS_SECRET must be configured with at least 32 characters");
    }

    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, typ: "access" },
      { secret, expiresIn: ACCESS_TOKEN_TTL, algorithm: "HS256", issuer: "anyskill-api", audience: "anyskill-client" },
    );

    const refreshToken = opaqueToken();
    const tokenFamilyId = randomUUID();
    await this.prisma.refreshSession.create({
      data: {
        userId,
        tokenHash: tokenHash(refreshToken),
        tokenFamilyId,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: 900,
    };
  }

  async refresh(refreshToken: string) {
    const oldHash = tokenHash(refreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: oldHash },
      include: { user: true },
    });

    if (!session) throw new UnauthorizedException("Refresh session is invalid or expired");

    const now = new Date();
    if (session.revokedAt) {
      // A previously rotated token being presented again is a reuse signal.
      // Revoke every still-active descendant in the same token family.
      await this.prisma.refreshSession.updateMany({
        where: { tokenFamilyId: session.tokenFamilyId, revokedAt: null },
        data: { revokedAt: now },
      });
      this.logger.warn(`Refresh-token reuse detected; revoked active sessions for userId=${session.userId}.`);
      throw new UnauthorizedException("Refresh session reuse detected. Sign in again.");
    }
    if (session.expiresAt <= now || session.user.deletedAt || !session.user.emailVerifiedAt) {
      throw new UnauthorizedException("Refresh session is invalid or expired");
    }

    const nextRefreshToken = opaqueToken();

    const rotated = await this.prisma.$transaction(async (tx) => {
      const revoke = await tx.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });

      if (revoke.count !== 1) return false;

      await tx.refreshSession.create({
        data: {
          userId: session.userId,
          tokenHash: tokenHash(nextRefreshToken),
          tokenFamilyId: session.tokenFamilyId,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        },
      });

      return true;
    });

    if (!rotated) throw new UnauthorizedException("Refresh session has already been used");

    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error("JWT_ACCESS_SECRET must be configured with at least 32 characters");
    }

    const accessToken = await this.jwt.signAsync(
      { sub: session.userId, email: session.user.email, typ: "access" },
      { secret, expiresIn: ACCESS_TOKEN_TTL, algorithm: "HS256", issuer: "anyskill-api", audience: "anyskill-client" },
    );

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      tokenType: "Bearer",
      expiresIn: 900,
    };
  }

  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException("This account is no longer active.");
    }

    // Reserve the account for deletion before touching external storage.
    // The shared eligibility lock prevents new requests, offers and matching
    // invitations from being created while private assets are being removed.
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('provider-eligibility'), hashtext(${userId}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('notification-delivery:' || ${userId}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('staff-membership'), hashtext(${userId}))`;

      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, deletedAt: true },
      });
      if (!current || current.deletedAt) throw new UnauthorizedException("This account is no longer active.");
      const staffMembership = await tx.staffMembership.findUnique({
        where: { userId },
        select: { role: true, isActive: true },
      });
      if (staffMembership?.isActive && staffMembership.role === "SUPER_ADMIN") {
        throw new ConflictException("The Super Administrator account cannot be self-deleted. Transfer administrator responsibility through the approved support process first.");
      }

      const [activeEngagement, openRequests, outstandingOffers, incomingInvitations] = await Promise.all([
        tx.jobEngagement.findFirst({
          where: { OR: [{ seekerId: userId }, { providerId: userId }], status: { not: "COMPLETED" } },
          select: { id: true, status: true },
        }),
        tx.serviceRequest.count({ where: { seekerId: userId, status: "OPEN" } }),
        tx.providerResponse.count({ where: { providerId: userId, status: "OFFERED" } }),
        tx.requestMatch.count({ where: { providerId: userId, status: "NOTIFIED" } }),
      ]);
      if (activeEngagement) {
        throw new ConflictException("Complete or resolve your active service engagement before deleting your account.");
      }
      if (openRequests > 0 || outstandingOffers > 0 || incomingInvitations > 0) {
        throw new ConflictException("Cancel your open service requests, withdraw outstanding offers, and decline incoming Provider invitations before deleting your account.");
      }

      await tx.user.update({
        where: { id: userId },
        data: { seekerRoleStatus: "SUSPENDED", providerRoleStatus: "SUSPENDED" },
      });
      await tx.providerProfile.updateMany({
        where: { userId },
        data: {
          isAvailable: false,
          liveLatitude: null,
          liveLongitude: null,
          liveAccuracyM: null,
          liveLocationUpdatedAt: null,
        },
      });
    });

    // Remove private files after marketplace actions have been blocked. If
    // storage cleanup fails, the suspended account can retry deletion safely.
    // intact so deletion can be retried without leaving private files behind.
    await this.media.deleteUserAssets(userId);

    await this.prisma.$transaction(async (tx) => {
      // Coordinate with push delivery so no queued private notification can be
      // sent after this account-deletion transaction commits.
      // Keep the same lock order as the deletion-reservation transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('provider-eligibility'), hashtext(${userId}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('notification-delivery:' || ${userId}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('staff-membership'), hashtext(${userId}))`;
      // Audit records contain account identifiers and are not marketplace history.
      await tx.staffAuditLog.deleteMany({
        where: { OR: [{ actorId: userId }, { targetUserId: userId }] },
      });

      // Preserve requests, responses, matches and jobs, but detach the deleted
      // account and remove user-supplied personal/contact/location information.
      await tx.serviceRequest.updateMany({
        where: { seekerId: userId },
        data: {
          seekerId: null,
          title: "Request retained after account deletion",
          description: "Request details removed following account deletion.",
          location: null,
          latitude: null,
          longitude: null,
          instructions: null,
          imageUrls: [],
        },
      });

      await tx.providerResponse.updateMany({
        where: { providerId: userId },
        data: { providerId: null, message: null },
      });

      await tx.requestMatch.updateMany({
        where: { providerId: userId },
        data: { providerId: null },
      });

      await tx.jobCostAdjustment.updateMany({
        where: { engagement: { is: { OR: [{ seekerId: userId }, { providerId: userId }] } } },
        data: { reason: "Adjustment details removed following account deletion.", decisionNote: null },
      });

      await tx.jobEngagement.updateMany({
        where: { OR: [{ seekerId: userId }, { providerId: userId }] },
        data: {
          seekerId: null,
          providerId: null,
          estimateNotes: null,
          estimateDecisionNote: null,
        },
      });

      await tx.jobCompletionSubmission.updateMany({
        where: { providerId: userId },
        data: {
          providerId: null,
          notes: "Completion details removed following account deletion.",
          evidenceUrls: [],
          reviewNote: null,
        },
      });

      // Remove all remaining account-owned data and credentials.
      await tx.mediaAsset.deleteMany({ where: { userId } });
      await tx.refreshSession.deleteMany({ where: { userId } });
      await tx.emailVerificationToken.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.passwordResetOtp.deleteMany({ where: { userId } });
      await tx.identityVerificationCase.deleteMany({ where: { userId } });
      await tx.pushDevice.deleteMany({ where: { userId } });
      await tx.appNotification.deleteMany({ where: { userId } });
      await tx.onboardingDraft.deleteMany({ where: { userId } });
      await tx.providerProfile.deleteMany({ where: { userId } });
      await tx.providerRoleApplication.deleteMany({ where: { userId } });
      await tx.staffMembership.deleteMany({ where: { userId } });
      await tx.pendingRegistration.deleteMany({ where: { email: user.email } });

      // Permanently remove the user row. No deletedAt tombstone remains.
      await tx.user.delete({ where: { id: userId } });
    });

    return {
      deleted: true,
      message: "Your AnySkill account and personal data have been permanently deleted. Requests and job history have been retained without your account details.",
    };
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash: tokenHash(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { loggedOut: true };
  }

  async requestPasswordReset(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const genericMessage = "If an account exists for that email, a six-digit password reset code has been sent.";
    if (!user || user.deletedAt) return { message: genericMessage, otpSent: true, expiresInSeconds: 600, resendAfterSeconds: 60 };

    const now = new Date();
    // Any legacy magic-link credentials are invalid as soon as a new OTP recovery is requested.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: now },
    });
    const existing = await this.prisma.passwordResetOtp.findUnique({ where: { userId: user.id } });
    if (existing && existing.resendAvailableAt > now) {
      return { message: genericMessage, otpSent: true, expiresInSeconds: 600,
        resendAfterSeconds: Math.ceil((existing.resendAvailableAt.getTime() - now.getTime()) / 1000) };
    }

    const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const data = {
      otpHash: this.passwordResetOtpHash(email, otp),
      attempts: 0,
      expiresAt: new Date(now.getTime() + RESET_OTP_TTL_MS),
      resendAvailableAt: new Date(now.getTime() + RESET_OTP_RESEND_MS),
      consumedAt: null,
    };
    if (existing) {
      const updated = await this.prisma.passwordResetOtp.updateMany({
        where: { id: existing.id, resendAvailableAt: { lte: now } },
        data,
      });
      if (updated.count !== 1) return { message: genericMessage, otpSent: true, expiresInSeconds: 600, resendAfterSeconds: 60 };
    } else {
      try {
        await this.prisma.passwordResetOtp.create({ data: { userId: user.id, ...data } });
      } catch (error) {
        // A concurrent request may have created the row. Do not disclose account existence.
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
          return { message: genericMessage, otpSent: true, expiresInSeconds: 600, resendAfterSeconds: 60 };
        }
        throw error;
      }
    }

    try {
      await this.mail.sendPasswordResetOtp(user.email, otp);
    } catch (error) {
      await this.prisma.passwordResetOtp.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { resendAvailableAt: new Date() },
      });
      this.logger.error("Password reset OTP email delivery failed.", error);
    }
    return { message: genericMessage, otpSent: true, expiresInSeconds: 600, resendAfterSeconds: 60 };
  }

  async resendPasswordResetOtp(emailInput: string) {
    return this.requestPasswordReset(emailInput);
  }

  async verifyPasswordResetOtp(emailInput: string, otp: string) {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) throw new UnauthorizedException("The code is invalid, expired or locked. Request a new code.");
    const row = await this.prisma.passwordResetOtp.findUnique({ where: { userId: user.id } });
    const now = new Date();
    if (!row || row.consumedAt || row.expiresAt <= now || row.attempts >= 5) {
      throw new UnauthorizedException("The code is invalid, expired or locked. Request a new code.");
    }

    const expected = Buffer.from(row.otpHash, "hex");
    const actual = Buffer.from(this.passwordResetOtpHash(email, otp), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await this.prisma.passwordResetOtp.updateMany({
        where: { id: row.id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException("The verification code is incorrect.");
    }

    const resetCredential = opaqueToken();
    const resetExpiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetOtp.updateMany({
        where: { id: row.id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new UnauthorizedException("The code has already been used.");
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash: tokenHash(resetCredential), expiresAt: resetExpiresAt },
      });
    });
    return { resetToken: resetCredential, expiresInSeconds: 600 };
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: tokenHash(token) },
    });

    if (!record || record.consumedAt || record.expiresAt <= new Date()) {
      throw new UnauthorizedException("The password reset session is invalid or expired");
    }

    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException("The password reset session has already been used");
      }

      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });
      await tx.refreshSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });

      await tx.appNotification.create({
        data: {
          userId: record.userId,
          title: "Password updated",
          body: "Your AnySkill password was changed successfully. If you did not make this change, contact support.",
          data: { type: "ACCOUNT_PASSWORD_UPDATED" },
        },
      });
    });

    return { passwordUpdated: true, ...await this.issueTokens(record.userId, (await this.prisma.user.findUniqueOrThrow({ where: { id: record.userId }, select: { email: true } })).email) };
  }
}
