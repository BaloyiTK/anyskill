import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validateProductionConfiguration } = require("../apps/api/dist/config/production-config.js");
const keys = [
  "NODE_ENV", "DATABASE_URL", "JWT_ACCESS_SECRET", "SMTP_HOST", "MAIL_FROM",
  "GOOGLE_PLACES_API_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
  "CLOUDINARY_URL", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET",
  "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "TRUST_PROXY_HOPS",
  "CORS_ALLOWED_ORIGINS", "PORT",
];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

try {
  Object.assign(process.env, {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/anyskill",
    JWT_ACCESS_SECRET: "integration-test-secret-that-is-not-used-in-production",
    SMTP_HOST: "smtp.example.invalid",
    MAIL_FROM: "no-reply@example.invalid",
    GOOGLE_PLACES_API_KEY: "test-google-places-key",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "test-upstash-token",
    CLOUDINARY_URL: "cloudinary://test-key:test-secret@test-cloud",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    TRUST_PROXY_HOPS: "1",
    CORS_ALLOWED_ORIGINS: "https://app.example.invalid",
    PORT: "3000",
  });

  assert.doesNotThrow(() => validateProductionConfiguration("api"));
  assert.doesNotThrow(() => validateProductionConfiguration("worker"));

  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.TRUST_PROXY_HOPS;
  assert.doesNotThrow(() => validateProductionConfiguration("worker"));
  assert.throws(() => validateProductionConfiguration("api"), /TRUST_PROXY_HOPS|CORS_ALLOWED_ORIGINS/);

  process.env.JWT_ACCESS_SECRET = "replace-this-secret";
  assert.throws(() => validateProductionConfiguration("worker"), /unique random secret/);

  console.log("Production API and worker configuration assertions passed.");
} finally {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}
