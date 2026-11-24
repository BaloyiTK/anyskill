import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from "@nestjs/common";
import nodemailer, { SendMailOptions, Transporter } from "nodemailer";

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  // SMTP health checks are observational: a temporary provider outage must not
  // prevent the API from starting. HTTPS providers are verified on first send.
  onModuleInit(): void {
    if (this.emailProvider !== "smtp") {
      const apiKey = this.emailProvider === "brevo"
        ? process.env.BREVO_API_KEY?.trim()
        : process.env.RESEND_API_KEY?.trim();
      if (apiKey && process.env.MAIL_FROM?.trim()) {
        this.logger.log(`${this.emailProvider} email API configured; SMTP verification skipped.`);
      } else {
        this.logger.error(`${this.emailProvider} email provider selected but its API key or MAIL_FROM is missing.`);
      }
      return;
    }

    void Promise.resolve()
      .then(() => this.getTransporter().verify())
      .then(() => this.logger.log("SMTP transport verification succeeded."))
      .catch((error: unknown) => {
        this.logger.error(`SMTP transport verification failed (code=${this.errorCode(error)}). Email delivery may be unavailable.`);
      });
  }

  private get emailProvider(): "brevo" | "resend" | "smtp" {
    const provider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
    if (provider === "brevo" || provider === "resend") return provider;
    return "smtp";
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
    const port = Number(process.env.SMTP_PORT?.trim() || 587);
    const secure = process.env.SMTP_SECURE?.trim().toLowerCase() === "true";
    if (!host || !Number.isInteger(port) || port <= 0 || Boolean(user) !== Boolean(pass)) {
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

  private get senderDetails(): { name: string; email: string } {
    const from = this.fromAddress;
    const match = from.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
    if (match) {
      const name = (match[1] ?? "").replace(/^["']|["']$/g, "").trim() || "AnySkill";
      const email = (match[2] ?? "").trim();
      if (email) return { name, email };
    }
    return { name: "AnySkill", email: from };
  }

  private async deliverWithBrevo(kind: string, email: string, options: SendMailOptions): Promise<string> {
    const apiKey = process.env.BREVO_API_KEY?.trim();
    if (!apiKey) throw new InternalServerErrorException("Brevo email delivery is not configured");

    const payload: Record<string, unknown> = {
      sender: this.senderDetails,
      to: [{ email }],
      subject: options.subject ?? "AnySkill notification",
    };
    if (typeof options.text === "string") payload.textContent = options.text;
    if (typeof options.html === "string") payload.htmlContent = options.html;
    if (!payload.textContent && !payload.htmlContent) {
      throw new InternalServerErrorException("Email content is missing");
    }

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    const responseBody = await response.json().catch(() => ({})) as { messageId?: string; message?: string; code?: string };
    if (!response.ok) {
      const error = new Error(`Brevo request failed with HTTP ${response.status}`) as Error & { code: string };
      error.code = `BREVO_HTTP_${response.status}`;
      this.logger.error(`Brevo rejected email (type=${kind}, recipient=${this.maskedRecipient(email)}, status=${response.status}, reason=${String(responseBody.message ?? responseBody.code ?? "unknown").slice(0, 160)}).`);
      throw error;
    }
    return responseBody.messageId ?? "accepted";
  }

  private async deliverWithResend(kind: string, email: string, options: SendMailOptions): Promise<string> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) throw new InternalServerErrorException("Resend email delivery is not configured");

    const payload: Record<string, unknown> = {
      from: this.fromAddress,
      to: [email],
      subject: options.subject ?? "AnySkill notification",
    };
    if (typeof options.text === "string") payload.text = options.text;
    if (typeof options.html === "string") payload.html = options.html;
    if (!payload.text && !payload.html) {
      throw new InternalServerErrorException("Email content is missing");
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    const responseBody = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
    if (!response.ok) {
      const error = new Error(`Resend request failed with HTTP ${response.status}`) as Error & { code: string };
      error.code = `RESEND_HTTP_${response.status}`;
      this.logger.error(`Resend rejected email (type=${kind}, recipient=${this.maskedRecipient(email)}, status=${response.status}, reason=${String(responseBody.message ?? responseBody.name ?? "unknown").slice(0, 160)}).`);
      throw error;
    }
    return responseBody.id ?? "accepted";
  }

  private async deliver(kind: string, email: string, options: SendMailOptions): Promise<void> {
    const startedAt = Date.now();
    try {
      let messageId: string;
      if (this.emailProvider === "brevo") {
        messageId = await this.deliverWithBrevo(kind, email, options);
        this.logger.log(`Brevo accepted email (type=${kind}, recipient=${this.maskedRecipient(email)}, messageId=${messageId}, durationMs=${Date.now() - startedAt}).`);
      } else if (this.emailProvider === "resend") {
        messageId = await this.deliverWithResend(kind, email, options);
        this.logger.log(`Resend accepted email (type=${kind}, recipient=${this.maskedRecipient(email)}, messageId=${messageId}, durationMs=${Date.now() - startedAt}).`);
      } else {
        const result = await this.getTransporter().sendMail({ ...options, from: this.fromAddress, to: email });
        messageId = String(result.messageId ?? "unknown");
        this.logger.log(`SMTP accepted email (type=${kind}, recipient=${this.maskedRecipient(email)}, messageId=${messageId}, durationMs=${Date.now() - startedAt}).`);
      }
    } catch (error) {
      this.logger.error(`Email delivery failed (type=${kind}, recipient=${this.maskedRecipient(email)}, provider=${this.emailProvider}, code=${this.errorCode(error)}, durationMs=${Date.now() - startedAt}).`);
      throw error;
    }
  }

  async sendRegistrationOtp(email: string, otp: string): Promise<void> {
    await this.deliver("registration-otp", email, {
      subject: "Your AnySkill verification code",
      text: `Your AnySkill verification code is ${otp}. It expires in 10 minutes. If you did not request it, ignore this email.`,
    });
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const url = `${process.env.APP_DEEP_LINK?.trim() || "anyskill://"}verify-email?token=${encodeURIComponent(token)}`;
    await this.deliver("email-verification", email, {
      subject: "Verify your AnySkill email address",
      text: `Verify your email address by opening this link: ${url}`,
    });
  }

  async sendPasswordResetOtp(email: string, otp: string): Promise<void> {
    await this.deliver("password-reset-otp", email, {
      subject: "Your AnySkill password reset code",
      text: `Your AnySkill password reset code is ${otp}. It expires in 10 minutes. If you did not request it, ignore this email.`,
    });
  }

  async sendWelcomeEmail(email: string, displayName: string, providerReviewPending: boolean): Promise<void> {
    const greeting = displayName.trim() ? `Hello ${displayName.trim()},` : "Hello,";
    const providerStatus = providerReviewPending
      ? "Your submitted Provider skills are pending review. They will only become available for matching after approval."
      : "If you also applied to become a Provider, your submitted skills are pending review and will only become available for matching after approval.";
    await this.deliver("profile-submission-welcome", email, {
      subject: "Welcome to AnySkill — profile submitted",
      text: [
        greeting,
        "",
        "Welcome to AnySkill. We have received your completed profile.",
        "",
        "Your identity verification is pending. We will notify you when its status changes.",
        providerStatus,
        "",
        "You can continue using any marketplace role that is already active on your account.",
        "",
        "Thank you for joining AnySkill.",
      ].join("\n"),
    });
  }
}
