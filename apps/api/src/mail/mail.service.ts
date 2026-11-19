import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from "@nestjs/common";
import nodemailer, { SendMailOptions, Transporter } from "nodemailer";

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  // SMTP health checks are observational: a temporary provider outage must not
  // prevent the API from starting. Individual send operations still fail safely.
  async onModuleInit(): Promise<void> {
    try {
      await this.getTransporter().verify();
      this.logger.log("SMTP transport verification succeeded.");
    } catch (error) {
      this.logger.error(`SMTP transport verification failed (code=${this.errorCode(error)}). Email delivery may be unavailable.`);
    }
  }

  private errorCode(error: unknown): string {
    if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code.slice(0, 64);
    return "unknown";
  }

  private maskedRecipient(email: string): string {
    const [localPart, domain] = email.split("@");
    return localPart && domain ? `${localPart.slice(0, 1)}***@${domain}` : "[invalid-email]";
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
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
      host, port, secure,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
    return this.transporter;
  }

  private get fromAddress(): string {
    const from = process.env.MAIL_FROM?.trim();
    if (!from) throw new InternalServerErrorException("Email delivery is not configured correctly");
    return from;
  }

  private async deliver(kind: string, email: string, options: SendMailOptions): Promise<void> {
    const startedAt = Date.now();
    try {
      const result = await this.getTransporter().sendMail(options);
      this.logger.log(`SMTP accepted email (type=${kind}, recipient=${this.maskedRecipient(email)}, messageId=${String(result.messageId ?? "unknown")}, durationMs=${Date.now() - startedAt}).`);
    } catch (error) {
      this.logger.error(`Email delivery failed (type=${kind}, recipient=${this.maskedRecipient(email)}, code=${this.errorCode(error)}, durationMs=${Date.now() - startedAt}).`);
      throw error;
    }
  }

  async sendRegistrationOtp(email: string, otp: string): Promise<void> {
    await this.deliver("registration-otp", email, {
      from: this.fromAddress, to: email, subject: "Your AnySkill verification code",
      text: `Your AnySkill verification code is ${otp}. It expires in 10 minutes. If you did not request it, ignore this email.`,
    });
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const url = `${process.env.APP_DEEP_LINK?.trim() || "anyskill://"}verify-email?token=${encodeURIComponent(token)}`;
    await this.deliver("email-verification", email, {
      from: this.fromAddress, to: email, subject: "Verify your AnySkill email address",
      text: `Verify your email address by opening this link: ${url}`,
    });
  }

  async sendPasswordResetOtp(email: string, otp: string): Promise<void> {
    await this.deliver("password-reset-otp", email, {
      from: this.fromAddress, to: email, subject: "Your AnySkill password reset code",
      text: `Your AnySkill password reset code is ${otp}. It expires in 10 minutes. If you did not request it, ignore this email.`,
    });
  }
}
