import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import net from "node:net";

const root = process.cwd();
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const git = process.platform === "win32" ? "git.exe" : "git";
const expectedBranch = "feature/shared-job-work-timer";
let failed = false;

function run(label, command, args, options = {}) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32" && command === pnpm,
    timeout: options.timeout ?? 180_000,
    env: process.env,
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
    run("Refresh branch comparison with origin", git, ["fetch", "--quiet", "origin", expectedBranch]);
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

console.log("AnySkill full local validation");
console.log("Read-only diagnostics except normal build output and Git remote-tracking refresh. No database writes or process termination.");

run("API TypeScript", pnpm, ["--filter", "@anyskill/api", "typecheck"]);
run("Mobile TypeScript", pnpm, ["--filter", "@anyskill/mobile", "typecheck"]);
run("Shared contracts TypeScript", pnpm, ["--filter", "@anyskill/api", "exec", "tsc", "--noEmit", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "../../packages/contracts/src/index.ts"]);

run("Prisma schema validation", pnpm, ["--filter", "@anyskill/api", "exec", "prisma", "validate"]);
run("Prisma migration status (read-only)", pnpm, ["--filter", "@anyskill/api", "exec", "prisma", "migrate", "status"]);
run("API production build", pnpm, ["--filter", "@anyskill/api", "build"], { timeout: 240_000 });

const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const apiPackage = JSON.parse(readFileSync(resolve(root, "apps/api/package.json"), "utf8"));
const mobilePackage = JSON.parse(readFileSync(resolve(root, "apps/mobile/package.json"), "utf8"));
if (rootPackage.scripts?.lint || apiPackage.scripts?.lint || mobilePackage.scripts?.lint) {
  console.log("\n=== Lint ===");
  if (rootPackage.scripts?.lint) run("Workspace lint", pnpm, ["lint"]);
  else {
    if (apiPackage.scripts?.lint) run("API lint", pnpm, ["--filter", "@anyskill/api", "lint"]);
    if (mobilePackage.scripts?.lint) run("Mobile lint", pnpm, ["--filter", "@anyskill/mobile", "lint"]);
  }
} else {
  console.log("\n! Lint skipped: no lint scripts are configured in the current workspace.");
}
if (rootPackage.scripts?.test || apiPackage.scripts?.test || mobilePackage.scripts?.test) {
  console.log("\n=== Automated tests ===");
  if (rootPackage.scripts?.test) run("Workspace tests", pnpm, ["test"]);
  else {
    if (apiPackage.scripts?.test) run("API tests", pnpm, ["--filter", "@anyskill/api", "test"]);
    if (mobilePackage.scripts?.test) run("Mobile tests", pnpm, ["--filter", "@anyskill/mobile", "test"]);
  }
} else {
  console.log("\n! Automated tests skipped: no test scripts are configured in the current workspace.");
}
console.log("! Expo device/Metro startup is not automated here; the API health checks below verify the running backend.");

checkDockerPostgres();

try {
  const configured = readMobileApiUrl();
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

console.log(failed ? "\nCHECK FAILED — review the errors above. No automatic repairs were made." : "\nALL CONFIGURED CHECKS PASSED.");
process.exitCode = failed ? 1 : 0;
