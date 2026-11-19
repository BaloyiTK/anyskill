import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const appConfigFactory = require("../apps/mobile/app.config.js");
const appConfig = require("../apps/mobile/app.json").expo;
const keys = ["EAS_BUILD_PROFILE", "EAS_BUILD_PLATFORM", "GOOGLE_MAPS_API_KEY", "GOOGLE_SERVICES_JSON"];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const tempDirectory = mkdtempSync(join(tmpdir(), "anyskill-mobile-config-"));

try {
  process.env.EAS_BUILD_PROFILE = "production";
  process.env.EAS_BUILD_PLATFORM = "android";
  delete process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_SERVICES_JSON;

  assert.throws(
    () => appConfigFactory({ config: appConfig }),
    /GOOGLE_MAPS_API_KEY is required for production Android builds/,
    "production Android builds must reject a missing Maps key",
  );

  process.env.GOOGLE_MAPS_API_KEY = "test-google-maps-key";
  assert.throws(
    () => appConfigFactory({ config: appConfig }),
    /Firebase google-services.json is required for production Android builds/,
    "production Android builds must reject a missing Firebase client file",
  );

  const firebaseFile = resolve(tempDirectory, "google-services.json");
  writeFileSync(firebaseFile, JSON.stringify({ project_info: { project_id: "anyskill-ci-test" } }));
  process.env.GOOGLE_SERVICES_JSON = firebaseFile;

  const configured = appConfigFactory({ config: appConfig });
  assert.equal(configured.android.googleServicesFile, firebaseFile);
  assert.equal(configured.android.config.googleMaps.apiKey, "test-google-maps-key");

  console.log("Mobile production configuration assertions passed.");
} finally {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  rmSync(tempDirectory, { recursive: true, force: true });
}
