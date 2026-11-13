import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { PrismaService } from "../database/prisma.service";
import { MailService } from "../mail/mail.service";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
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
  ) {}

  private registrationOtpHash(email: string, otp: string): string {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) throw new Error("JWT_ACCESS_SECRET must be configured.");
    return createHmac("sha256", secret).update(`${email.toLowerCase()}:${otp}`).digest("hex");
  }

  async register(input: { email: string; mode?: "SEEKER" | "PROVIDER" }) {
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException("An account with this email already exists.");
    const previous = await this.prisma.pendingRegistration.findUnique({ where: { email } });
    const now = new Date();
    if (previous?.verifiedAt) throw new ConflictException("Email verification is already complete. Continue registration.");
    if (previous && previous.resendAvailableAt > now) throw new ConflictException("A code was sent recently. Please wait before requesting another.");
    const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await this.prisma.pendingRegistration.upsert({
      where: { email },
      create: { email, mode: input.mode ?? "SEEKER", otpHash: this.registrationOtpHash(email, otp), expiresAt: new Date(now.getTime()+600000), resendAvailableAt: new Date(now.getTime()+60000) },
      update: { mode: input.mode ?? "SEEKER", otpHash: this.registrationOtpHash(email, otp), attempts: 0, expiresAt: new Date(now.getTime()+600000), resendAvailableAt: new Date(now.getTime()+60000), verifiedAt: null, registrationTokenHash: null, registrationTokenExpiresAt: null },
    });
    await this.mail.sendRegistrationOtp(email, otp);
    return { otpSent: true, expiresInSeconds: 600, resendAfterSeconds: 60, message: "A six-digit verification code has been sent to your email address." };
  }

  async resendRegistrationOtp(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException("An account with this email already exists.");
    }

    const pending = await this.prisma.pendingRegistration.findUnique({ where: { email } });
    const now = new Date();
    if (!pending || pending.verifiedAt) {
      throw new ConflictException("There is no pending email verification for this address. Start registration again.");
    }
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
      throw new UnauthorizedException("The verification code is incorrect.");
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
        const created=await tx.user.create({data:{email:row.email,passwordHash,emailVerifiedAt:now,initialMode:row.mode},select:{id:true,email:true,createdAt:true}});
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
  ) {
    const idToken = await this.exchangeGoogleAuthorizationCode(code, codeVerifier, redirectUri);
    return this.googleSignIn(idToken);
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

  async googleSignIn(idToken: string) {
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
      { secret, expiresIn: ACCESS_TOKEN_TTL },
    );

    const refreshToken = opaqueToken();
    await this.prisma.refreshSession.create({
      data: {
        userId,
        tokenHash: tokenHash(refreshToken),
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

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException("Refresh session is invalid or expired");
    }

    const nextRefreshToken = opaqueToken();
    const now = new Date();

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
      { secret, expiresIn: ACCESS_TOKEN_TTL },
    );

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      tokenType: "Bearer",
      expiresIn: 900,
    };
  }

  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, deletedAt: true } });
    if (!user || user.deletedAt) throw new UnauthorizedException("This account is no longer active.");

    const now = new Date();
    const replacementEmail = `deleted-${userId}@deleted.anyskill.invalid`;
    const replacementPasswordHash = await argon2.hash(opaqueToken(), {
      type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.emailVerificationToken.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.identityVerificationCase.deleteMany({ where: { userId } });
      await tx.pushDevice.deleteMany({ where: { userId } });
      await tx.appNotification.deleteMany({ where: { userId } });
      await tx.mediaAsset.deleteMany({ where: { userId } });
      await tx.onboardingDraft.deleteMany({ where: { userId } });
      await tx.providerProfile.deleteMany({ where: { userId } });

      // Keep job and response records needed for disputes, payments and audit history,
      // but remove the account holder's free-text response message.
      await tx.providerResponse.updateMany({ where: { providerId: userId }, data: { message: null } });

      await tx.user.update({
        where: { id: userId },
        data: {
          email: replacementEmail,
          phone: null,
          googleSubject: null,
          passwordHash: replacementPasswordHash,
          emailVerifiedAt: null,
          identityVerification: "REVOKED",
          identityVerifiedAt: null,
          homeLocationLabel: null,
          homeLatitude: null,
          homeLongitude: null,
          deletedAt: now,
        },
      });
    });

    return { deleted: true };
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

    // Always return the same response to avoid account enumeration.
    if (user) {
      const token = opaqueToken();
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.passwordResetToken.updateMany({
          where: { userId: user.id, consumedAt: null },
          data: { consumedAt: now },
        }),
        this.prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: tokenHash(token),
            expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
          },
        }),
      ]);
      try {
        await this.mail.sendPasswordResetEmail(user.email, token);
      } catch (error) {
        this.logger.error("Password reset email delivery failed.", error);
      }
    }

    return { message: "If an account exists for that email, password reset instructions have been sent." };
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: tokenHash(token) },
    });

    if (!record || record.consumedAt || record.expiresAt <= new Date()) {
      throw new UnauthorizedException("The password reset link is invalid or expired");
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
        throw new UnauthorizedException("The password reset link has already been used");
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

    return { passwordUpdated: true };
  }
}
