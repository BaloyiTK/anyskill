import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { MailService } from "../mail/mail.service";

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async resend(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Keep the response identical for existing and unknown addresses.
    if (user && !user.emailVerifiedAt) {
      const token = randomBytes(48).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const now = new Date();

      await this.prisma.$transaction([
        this.prisma.emailVerificationToken.updateMany({
          where: { userId: user.id, consumedAt: null },
          data: { consumedAt: now },
        }),
        this.prisma.emailVerificationToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        }),
      ]);

      try {
        await this.mail.sendVerificationEmail(user.email, token);
      } catch (error) {
        this.logger.error("Resend verification email delivery failed.", error);
      }
    }

    return {
      message: "If the account exists and still needs verification, a new email has been sent.",
    };
  }
}
