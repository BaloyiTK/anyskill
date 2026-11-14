import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const errors = [];
const notices = [];

function fail(message) {
  errors.push(message);
}

function requireFile(path) {
  if (!existsSync(resolve(root, path))) fail(`Required project document/file is missing: ${path}`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(resolve(root, path), "utf8"));
  } catch (error) {
    fail(`Could not read valid JSON from ${path}: ${error.message}`);
    return {};
  }
}

function exactVersion(name, version, actual) {
  if (actual !== version) {
    fail(`${name} must remain pinned to ${version}; found ${actual ?? "missing"}.`);
  }
}

console.log("AnySkill protected project configuration check");

for (const path of ["AGENTS.md", "ENGINEERING_STANDARDS.md", "PROJECT_RULES.md", "docs/architecture"]) {
  requireFile(path);
}

const agents = existsSync(resolve(root, "AGENTS.md"))
  ? readFileSync(resolve(root, "AGENTS.md"), "utf8")
  : "";
for (const requiredReference of ["ENGINEERING_STANDARDS.md", "PROJECT_RULES.md", "docs/architecture"]) {
  if (!agents.includes(requiredReference)) fail(`AGENTS.md must require contributors to read ${requiredReference}.`);
}

const rootPackage = readJson("package.json");
if (rootPackage.packageManager !== "pnpm@10.0.0") {
  fail(`Root packageManager must remain pnpm@10.0.0; found ${rootPackage.packageManager ?? "missing"}.`);
}

const mobilePackage = readJson("apps/mobile/package.json");
const dependencies = {
  ...(mobilePackage.dependencies ?? {}),
  ...(mobilePackage.devDependencies ?? {}),
};
for (const [name, version] of Object.entries(dependencies)) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`Mobile dependency ${name} must use an exact version; found ${version}.`);
  }
}

const baseline = {
  expo: "58.0.25",
  "expo-auth-session": "58.0.18",
  "expo-camera": "58.0.14",
  "expo-crypto": "58.0.8",
  "expo-dev-client": "58.0.20",
  "expo-file-system": "58.0.13",
  "expo-image-picker": "58.0.10",
  "expo-location": "58.0.22",
  "expo-maps": "58.0.11",
  "expo-notifications": "58.1.9",
  "expo-secure-store": "58.0.3",
  react: "19.3.0",
  "react-native": "0.88.1",
  "react-native-safe-area-context": "5.11.1",
  "@types/node": "24.19.2",
  "@types/react": "19.3.0",
  typescript: "6.0.3",
};
for (const [name, version] of Object.entries(baseline)) {
  exactVersion(name, version, dependencies[name]);
}
if (dependencies["expo-system-ui"] !== undefined) {
  exactVersion("expo-system-ui", "58.0.7", dependencies["expo-system-ui"]);
}

const appConfig = readJson("apps/mobile/app.json").expo ?? {};
if (appConfig.slug !== "anyskill") fail("Expo slug must remain anyskill.");
if (appConfig.owner !== "baloyitk") fail("Expo owner must remain baloyitk.");
if (appConfig.android?.package !== "com.anyskill.mobile") {
  fail("Android application ID must remain com.anyskill.mobile.");
}
if (appConfig.extra?.eas?.projectId !== "2927d4f0-8523-4d2c-9c19-7172f7d16d26") {
  fail("The existing EAS project ID is missing or has changed.");
}

const plugins = appConfig.plugins ?? [];
const hasMapsPlugin = plugins.some((plugin) =>
  (Array.isArray(plugin) ? plugin[0] : plugin) === "expo-maps"
);
if (!hasMapsPlugin) fail("The expo-maps config plugin must remain in apps/mobile/app.json.");

const devClientPlugin = plugins.find((plugin) =>
  (Array.isArray(plugin) ? plugin[0] : plugin) === "expo-dev-client"
);
if (!Array.isArray(devClientPlugin) ||
    devClientPlugin[1]?.launchMode !== "launcher" ||
    devClientPlugin[1]?.addGeneratedScheme !== true) {
  fail("The expo-dev-client plugin must register its generated scheme and open the development launcher.");
}
if (mobilePackage.scripts?.start !== "expo start --dev-client --lan") {
  fail("The mobile start script must explicitly start the development client over LAN.");
}

const eas = readJson("apps/mobile/eas.json");
if (typeof eas.cli?.version !== "string" || !eas.cli.version.includes("27.10.0")) {
  fail("apps/mobile/eas.json must retain the approved EAS CLI compatibility floor (27.10.0).");
}
const requiredProfiles = ["development", "preview", "production"];
for (const profile of requiredProfiles) {
  if (!eas.build?.[profile]) fail(`Missing required EAS build profile: ${profile}.`);
}
if (eas.build?.development?.developmentClient !== true ||
    eas.build?.development?.distribution !== "internal" ||
    eas.build?.development?.android?.buildType !== "apk") {
  fail("The development EAS profile must remain an internal development-client APK.");
}
if (eas.build?.preview?.distribution !== "internal" ||
    eas.build?.preview?.android?.buildType !== "apk") {
  fail("The preview EAS profile must remain an internal APK.");
}
if (eas.build?.production?.android?.buildType !== "app-bundle") {
  fail("The production EAS profile must remain an Android App Bundle.");
}

const gitignore = existsSync(resolve(root, ".gitignore"))
  ? readFileSync(resolve(root, ".gitignore"), "utf8")
  : "";
if (!gitignore.split(/\r?\n/).includes("/apps/mobile/android/")) {
  fail("Root .gitignore must keep generated apps/mobile/android/ out of Git.");
}

const lockfile = existsSync(resolve(root, "pnpm-lock.yaml"))
  ? readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8")
  : "";
if (!/^lockfileVersion:\s*'?(?:9\.0)'?/m.test(lockfile)) {
  fail("pnpm-lock.yaml must retain lockfileVersion 9.0.");
}

if (errors.length) {
  console.error("\nPROJECT CONFIGURATION CHECK FAILED");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("✓ Required standards and architecture documents exist.");
  console.log("✓ AI agent instructions reference the mandatory project standards.");
  console.log("✓ Mobile direct dependencies use exact versions and the approved baseline is intact.");
  console.log("✓ Expo owner, slug, Android application ID, and EAS project ID are protected.");
  console.log("✓ Expo Maps and development-client plugins preserve native Maps and QR/deep-link behavior.");
  console.log("✓ Mobile Metro starts explicitly in development-client LAN mode.");
  console.log("✓ All three EAS build profiles are protected.");
  console.log("✓ Generated Android native project remains ignored.");
  console.log("✓ pnpm lockfile format is protected.");
  if (notices.length) for (const notice of notices) console.log(`! ${notice}`);
  console.log("\nALL PROJECT CONFIGURATION CHECKS PASSED.");
}
