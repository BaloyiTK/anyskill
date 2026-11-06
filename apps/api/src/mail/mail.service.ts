import { Injectable, InternalServerErrorException } from "@nestjs/common";
import nodemailer, { Transporter } from "nodemailer";

@Injectable()
export class MailService {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;
    const port = Number(process.env.SMTP_PORT ?? 587);

    if (!host || !process.env.MAIL_FROM || Boolean(user) !== Boolean(pass)) {
      throw new InternalServerErrorException("Email delivery is not configured correctly");
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === "true",
      ...(user && pass ? { auth: { user, pass } } : {}),
    });

    return this.transporter;
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const url = `${process.env.APP_DEEP_LINK ?? "anyskill://"}verify-email?token=${encodeURIComponent(token)}`;
    await this.getTransporter().sendMail({
      from: process.env.MAIL_FROM!,
      to: email,
      subject: "Verify your AnySkill email address",
      text: `Verify your email address by opening this link: ${url}`,
    });
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const url = `${process.env.APP_DEEP_LINK ?? "anyskill://"}reset-password?token=${encodeURIComponent(token)}`;
    await this.getTransporter().sendMail({
      from: process.env.MAIL_FROM!,
      to: email,
      subject: "Reset your AnySkill password",
      text: `If you requested a password reset, open this link: ${url}`,
    });
  }
}
