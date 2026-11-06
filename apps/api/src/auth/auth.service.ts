import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
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

  async register(input: { email: string; password: string; phone?: string }) {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException("An account with this email already exists");

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        ...(input.phone ? { phone: input.phone.trim() } : {}),
      },
      select: { id: true, email: true, createdAt: true },
    });

    const token = opaqueToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
      },
    });

    try {
      await this.mail.sendVerificationEmail(user.email, token);
    } catch (error) {
      this.logger.error("Verification email delivery failed; user can request a resend.", error);
    }

    return {
      user,
      emailVerificationRequired: true,
      message: "Check your email to verify your address before signing in.",
    };
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
    });

    return { emailVerified: true };
  }

  private async verifyGoogleIdToken(idToken: string) {
    const audiences = (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

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
      throw new ConflictException(
        "An account already uses this email. Sign in with that account first, then connect Google from account settings.",
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
    });

    return { passwordUpdated: true };
  }
}
