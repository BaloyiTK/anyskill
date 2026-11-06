import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { MailService } from "../mail/mail.service";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function opaqueToken(): string {
  return randomBytes(48).toString("base64url");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class AuthService {
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

    await this.mail.sendVerificationEmail(user.email, token);

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

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: record.user.emailVerifiedAt ?? new Date() },
      }),
    ]);

    return { emailVerified: true };
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
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      await this.mail.sendPasswordResetEmail(user.email, token);
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

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.refreshSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { passwordUpdated: true };
  }
}
