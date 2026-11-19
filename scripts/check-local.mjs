import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { createHealthUrl, isLocalIPv4Address, parseEnvKeys, parseMobileApiUrl } from "./check-local-utils.mjs";

const root = process.cwd();
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const node = process.execPath;
const git = process.platform === "win32" ? "git.exe" : "git";
const expectedBranch = "feature/shared-job-work-timer";
let failed = false;
const skipped = [];

function run(label, command, args, options = {}) {
  console.log(`\n=== ${label} ===`);
  // pnpm exposes its JS entrypoint to lifecycle scripts. Invoke it with Node
  // directly on Windows to avoid shell=true and Node's DEP0190 warning.
  const pnpmEntrypoint = command === pnpm && process.env.npm_execpath && existsSync(process.env.npm_execpath)
    ? process.env.npm_execpath
    : null;
  const executable = pnpmEntrypoint ? node : command;
  const executableArgs = pnpmEntrypoint ? [pnpmEntrypoint, ...args] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    shell: !pnpmEntrypoint && process.platform === "win32" && command === pnpm,
    timeout: options.timeout ?? 180_000,
    env: { ...process.env, ...(options.env ?? {}) },
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    failed = true;
    console.error(`✗ ${label} failed${result.error ? `: ${result.error.message}` : ""}`);
    return false;
  }
  console.log(`✓ ${label} passed`);
  return true;
}

function gitOutput(args) {
  const result = spawnSync(git, args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr?.trim() || "Git command failed");
  return result.stdout.trim();
}

function getLocalIPv4Addresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)];
}

function checkApiEnvironment() {
  console.log("\n=== API environment configuration ===");
  const envPath = resolve(root, "apps/api/.env");
  if (!existsSync(envPath)) {
    failed = true;
    console.error("✗ apps/api/.env is missing. Create it locally; do not commit secrets.");
    return;
  }
  const keys = parseEnvKeys(readFileSync(envPath, "utf8"));
  const required = ["DATABASE_URL", "JWT_ACCESS_SECRET"];
  const missing = required.filter((key) => !keys.has(key));
  if (missing.length) {
    failed = true;
    console.error(`✗ Required API environment variable(s) missing: ${missing.join(", ")}. Values are not displayed.`);
    return;
  }
  console.log("✓ Required API environment variable names are present (values hidden)");
}

function readMobileApiUrl() {
  const envPath = resolve(root, "apps/mobile/.env");
  if (!existsSync(envPath)) {
    throw new Error("apps/mobile/.env was not found. Create it from apps/mobile/.env.example and set EXPO_PUBLIC_API_URL to your computer's LAN URL.");
  }
  const envText = readFileSync(envPath, "utf8");
  const line = envText.split(/\r?\n/).find((entry) => /^\s*EXPO_PUBLIC_API_URL\s*=/.test(entry));
  if (!line) throw new Error("EXPO_PUBLIC_API_URL is missing from apps/mobile/.env.");
  const value = line.slice(line.indexOf("=") + 1).trim().replace(/^[\"']|[\"']$/g, "");
  let url;
  try { url = new URL(value); } catch { throw new Error("EXPO_PUBLIC_API_URL must be a valid absolute HTTP(S) URL."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("EXPO_PUBLIC_API_URL must use HTTP or HTTPS.");
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error("EXPO_PUBLIC_API_URL must use your computer's LAN address, not localhost.");
  }
  return url;
}

function checkConfiguredLanAddress(url) {
  console.log("\n=== LAN address configuration ===");
  const localAddresses = getLocalIPv4Addresses();
  if (!isLocalIPv4Address(url.hostname, localAddresses)) {
    failed = true;
    console.error(`✗ Configured API host ${url.hostname} is not assigned to this computer.`);
    console.error(`  Current non-loopback IPv4 address(es): ${localAddresses.join(", ") || "none detected"}`);
    console.error("  Update EXPO_PUBLIC_API_URL in apps/mobile/.env to the current reachable LAN address.");
    return;
  }
  if (net.isIP(url.hostname) === 4) {
    console.log(`✓ Configured API host ${url.hostname} matches a local IPv4 interface`);
  } else {
    console.log("! API host is a hostname; local-interface matching was not performed.");
  }
}

async function checkHealth(label, url) {
  console.log(`\n=== ${label}: ${url.href} ===`);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status !== "ok" || payload?.service !== "anyskill-api") {
      throw new Error(`Unexpected response (HTTP ${response.status}): ${JSON.stringify(payload)}`);
    }
    console.log(`✓ ${label} healthy (HTTP ${response.status})`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${label} failed: ${error.message}`);
    if (label === "Configured LAN API") {
      console.error("  If localhost passed, check Windows Firewall inbound TCP port 3000 and whether the phone is on a network that can reach this PC.");
    }
  }
}

function checkDockerPostgres() {
  console.log("\n=== Docker PostgreSQL readiness ===");
  const result = spawnSync("docker", ["inspect", "--format", "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}", "anyskill-postgres"], {
    cwd: root, encoding: "utf8", windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    failed = true;
    console.error("✗ Could not inspect anyskill-postgres. Make sure Docker Desktop and the project database container are running.");
    return;
  }
  const state = result.stdout.trim();
  if (!state.startsWith("running healthy")) {
    failed = true;
    console.error(`✗ anyskill-postgres is not healthy (reported: ${state}). Start/review it with docker compose; this check will not change it.`);
    return;
  }
  console.log("✓ anyskill-postgres is running and healthy");
}

function checkGit() {
  console.log("\n=== Git branch and sync ===");
  try {
    const branch = gitOutput(["branch", "--show-current"]);
    if (branch !== expectedBranch) throw new Error(`Expected branch ${expectedBranch}, currently on ${branch || "(detached HEAD)"}.`);
    console.log(`✓ On expected branch: ${branch}`);

    const status = gitOutput(["status", "--short"]);
    if (status) console.log("! Working tree has local changes (left untouched):\n" + status);
    else console.log("✓ Working tree is clean");

    const upstream = gitOutput(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
    const fetch = spawnSync(git, ["fetch", "--quiet", "origin", expectedBranch], { cwd: root, encoding: "utf8", windowsHide: true });
    if (fetch.status !== 0) throw new Error(fetch.stderr?.trim() || "Could not refresh origin branch comparison.");
    console.log("✓ Refreshed origin branch comparison");
    const counts = gitOutput(["rev-list", "--left-right", "--count", `HEAD...${upstream}`]).split(/\s+/).map(Number);
    const [ahead, behind] = counts;
    if (behind > 0) {
      failed = true;
      console.error(`✗ Local branch is behind ${upstream} by ${behind} commit(s). Pull before continuing.`);
    } else {
      console.log(`✓ Local branch is up to date with ${upstream}${ahead > 0 ? ` (${ahead} local commit(s) ahead)` : ""}`);
    }
  } catch (error) {
    failed = true;
    console.error(`✗ Git check failed: ${error.message}`);
  }
}

function checkAdminJavaScript() {
  const adminFiles = ["apps/admin/server.mjs", "apps/admin/main.js"];
  const present = adminFiles.filter((file) => existsSync(resolve(root, file)));
  if (!present.length) {
    skipped.push("Admin portal syntax checks (admin source files not found)");
    console.log("\n! Admin portal syntax checks skipped: expected source files were not found.");
    return;
  }
  for (const file of present) run(`Admin syntax: ${file}`, node, ["--check", file]);
}

function checkOptionalQualityGates(rootPackage, apiPackage, mobilePackage) {
  const packages = [
    ["Workspace", rootPackage],
    ["API", apiPackage],
    ["Mobile", mobilePackage],
  ];
  const lintTargets = packages.filter(([, pkg]) => typeof pkg.scripts?.lint === "string");
  if (lintTargets.length) {
    console.log("\n=== Lint ===");
    for (const [label] of lintTargets) {
      if (label === "Workspace") run("Workspace lint", pnpm, ["lint"]);
      else run(`${label} lint`, pnpm, ["--filter", label === "API" ? "@anyskill/api" : "@anyskill/mobile", "lint"]);
    }
  } else {
    skipped.push("Lint (no lint scripts configured)");
    console.log("\n! Lint skipped: no lint scripts are configured in the current workspace.");
  }

  const testTargets = packages.filter(([, pkg]) => typeof pkg.scripts?.test === "string");
  if (testTargets.length) {
    console.log("\n=== Automated tests ===");
    for (const [label] of testTargets) {
      if (label === "Workspace") run("Workspace tests", pnpm, ["test"]);
      else run(`${label} tests`, pnpm, ["--filter", label === "API" ? "@anyskill/api" : "@anyskill/mobile", "test"]);
    }
  } else {
    skipped.push("Automated tests (no test scripts configured)");
    console.log("\n! Automated tests skipped: no test scripts are configured in the current workspace.");
  }

  if (process.env.ANYSKILL_RUN_SECURITY_AUDIT === "1") {
    run("Production dependency security audit (requires internet)", pnpm, ["audit", "--prod", "--audit-level", "high"], { timeout: 240_000 });
  } else {
    skipped.push("Dependency security audit (opt-in; set ANYSKILL_RUN_SECURITY_AUDIT=1)");
    console.log("\n! Dependency audit skipped by default. Set ANYSKILL_RUN_SECURITY_AUDIT=1 to run pnpm audit (internet required).");
  }
}

console.log("AnySkill full local validation");
console.log("Diagnostics preserve local changes and do not write to the database or terminate running processes.");
console.log("Build outputs may be generated; the mobile bundle export uses a temporary directory that is removed afterwards.");

const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const apiPackage = JSON.parse(readFileSync(resolve(root, "apps/api/package.json"), "utf8"));
const mobilePackage = JSON.parse(readFileSync(resolve(root, "apps/mobile/package.json"), "utf8"));

run("API TypeScript", pnpm, ["--filter", "@anyskill/api", "typecheck"]);
run("Mobile TypeScript", pnpm, ["--filter", "@anyskill/mobile", "typecheck"]);
run("Shared contracts TypeScript", pnpm, ["--filter", "@anyskill/api", "exec", "tsc", "--project", "../../packages/contracts/tsconfig.json", "--noEmit"]);

run("Prisma schema validation", pnpm, ["--filter", "@anyskill/api", "exec", "prisma", "validate"]);
run("Prisma migration status (read-only)", pnpm, ["--filter", "@anyskill/api", "exec", "prisma", "migrate", "status"]);
run("API build compile (Nest; avoids regenerating Prisma Client)", pnpm, ["--filter", "@anyskill/api", "exec", "nest", "build"], { timeout: 240_000 });

checkApiEnvironment();
checkAdminJavaScript();
checkOptionalQualityGates(rootPackage, apiPackage, mobilePackage);

const mobileBuildDir = mkdtempSync(resolve(tmpdir(), "anyskill-mobile-export-"));
try {
  run("Mobile Android JavaScript bundle export (not a native APK build)", pnpm, ["--filter", "@anyskill/mobile", "exec", "expo", "export", "--platform", "android", "--output-dir", mobileBuildDir], { timeout: 300_000 });
} finally {
  rmSync(mobileBuildDir, { recursive: true, force: true });
}

console.log("\n! Expo device/Metro startup and physical-device interaction are not automated by this script.");

checkDockerPostgres();

try {
  const configured = readMobileApiUrl();
  checkConfiguredLanAddress(configured);
  const healthPath = `${configured.pathname.replace(/\/+$/, "")}/health`.replace(/\/{2,}/g, "/");
  const localhost = new URL(configured);
  localhost.hostname = "localhost";
  localhost.pathname = healthPath;
  localhost.search = "";
  localhost.hash = "";
  const lan = new URL(configured);
  lan.pathname = healthPath;
  lan.search = "";
  lan.hash = "";
  await checkHealth("Localhost API", localhost);
  await checkHealth("Configured LAN API", lan);
} catch (error) {
  failed = true;
  console.error(`\n✗ Health-check setup failed: ${error.message}`);
}

checkGit();

console.log("\n=== Validation summary ===");
if (skipped.length) {
  console.log("Skipped / not yet configured:");
  for (const item of skipped) console.log(`- ${item}`);
}
console.log(failed ? "\nCHECK FAILED — review the errors above. No automatic repairs were made." : "\nALL EXECUTED CHECKS PASSED — review skipped checks before treating this as a complete quality gate.");
process.exitCode = failed ? 1 : 0;
