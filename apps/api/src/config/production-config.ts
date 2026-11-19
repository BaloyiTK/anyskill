export type ProductionProcessRole = "api" | "worker";

export function validateProductionConfiguration(role: ProductionProcessRole): void {
  if (process.env.NODE_ENV !== "production") return;

  const required = [
    "DATABASE_URL",
    "JWT_ACCESS_SECRET",
    "SMTP_HOST",
    "MAIL_FROM",
    "GOOGLE_PLACES_API_KEY",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    ...(role === "api" ? ["TRUST_PROXY_HOPS", "CORS_ALLOWED_ORIGINS"] : []),
  ];
  const missing = required.filter((key) => !process.env[key]?.trim());

  const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim();
  const cloudinaryPartsPresent = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
    process.env.CLOUDINARY_API_KEY?.trim() &&
    process.env.CLOUDINARY_API_SECRET?.trim(),
  );
  let cloudinaryUrlValid = false;
  if (cloudinaryUrl) {
    try {
      const parsed = new URL(cloudinaryUrl);
      cloudinaryUrlValid = parsed.protocol === "cloudinary:" &&
        Boolean(parsed.hostname && parsed.username && parsed.password);
    } catch {
      cloudinaryUrlValid = false;
    }
  }
  if (!cloudinaryUrlValid && !cloudinaryPartsPresent) {
    missing.push("valid CLOUDINARY_URL (or all CLOUDINARY_* split credentials)");
  }

  const jwtSecret = process.env.JWT_ACCESS_SECRET?.trim() ?? "";
  if (jwtSecret && (jwtSecret.length < 32 || /replace|example|changeme|your[_ -]?secret/i.test(jwtSecret))) {
    throw new Error("JWT_ACCESS_SECRET must be a unique random secret of at least 32 characters in production.");
  }
  const smtpUser = Boolean(process.env.SMTP_USER?.trim());
  const smtpPassword = Boolean(process.env.SMTP_PASSWORD?.trim());
  if (smtpUser !== smtpPassword) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must either both be configured or both be empty.");
  }
  const smtpPort = Number(process.env.SMTP_PORT?.trim() || 587);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port in production.");
  }
  const smtpSecure = process.env.SMTP_SECURE?.trim().toLowerCase();
  if (smtpSecure && smtpSecure !== "true" && smtpSecure !== "false") {
    throw new Error("SMTP_SECURE must be either true or false.");
  }

  if (role === "api") {
    const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS);
    if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) {
      throw new Error("TRUST_PROXY_HOPS must be explicitly configured as an integer between 0 and 10 in production.");
    }
    const port = Number(process.env.PORT?.trim() || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("PORT must be a valid TCP port in production.");
    }

    const origins = (process.env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
    for (const origin of origins) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error("CORS_ALLOWED_ORIGINS contains an invalid origin.");
      }
      if (parsed.protocol !== "https:" || parsed.origin !== origin) {
        throw new Error("Production CORS origins must be exact HTTPS origins without paths.");
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required production configuration for ${role}: ${missing.join(", ")}`);
  }
}
