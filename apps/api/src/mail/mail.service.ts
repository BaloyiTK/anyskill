import { Injectable, InternalServerErrorException } from "@nestjs/common";
import nodemailer, { Transporter } from "nodemailer";

@Injectable()
export class MailService {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    // Trim environment values so the project's spaced .env assignment style
    // (for example: SMTP_USER = account@example.com) works consistently.
    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASSWORD?.trim();
    const from = process.env.MAIL_FROM?.trim();
    const port = Number(process.env.SMTP_PORT?.trim() || 587);
    const secure = process.env.SMTP_SECURE?.trim().toLowerCase() === "true";

    if (!host || !from || !Number.isInteger(port) || port <= 0 || Boolean(user) !== Boolean(pass)) {
      throw new InternalServerErrorException("Email delivery is not configured correctly");
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });

    return this.transporter;
  }

  private get fromAddress(): string {
    const from = process.env.MAIL_FROM?.trim();
    if (!from) {
      throw new InternalServerErrorException("Email delivery is not configured correctly");
    }
    return from;
  }

  async sendRegistrationOtp(email: string, otp: string): Promise<void> {
    await this.getTransporter().sendMail({
      from: this.fromAddress,
      to: email,
      subject: "Your AnySkill verification code",
      text: `Your AnySkill verification code is ${otp}. It expires in 10 minutes. If you did not request it, ignore this email.`,
    });
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const url = `${process.env.APP_DEEP_LINK?.trim() || "anyskill://"}verify-email?token=${encodeURIComponent(token)}`;
    await this.getTransporter().sendMail({
      from: this.fromAddress,
      to: email,
      subject: "Verify your AnySkill email address",
      text: `Verify your email address by opening this link: ${url}`,
    });
  }

  async sendPasswordResetOtp(email: string, otp: string): Promise<void> {
    await this.getTransporter().sendMail({
      from: this.fromAddress,
      to: email,
      subject: "Your AnySkill password reset code",
      text: `Your AnySkill password reset code is ${otp}. It expires in 10 minutes. If you did not request it, ignore this email.`,
    });
  }
}
