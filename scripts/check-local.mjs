import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
let failed = false;

function runTypecheck(label, args) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(packageManager, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error || result.status !== 0) {
    failed = true;
    console.error(`✗ ${label} failed`);
  } else {
    console.log(`✓ ${label} passed`);
  }
}

function readMobileApiUrl() {
  const envPath = resolve(root, "apps/mobile/.env");
  if (!existsSync(envPath)) {
    throw new Error("apps/mobile/.env was not found. Create it from apps/mobile/.env.example and set EXPO_PUBLIC_API_URL to your computer's LAN URL.");
  }

  const envText = readFileSync(envPath, "utf8");
  const line = envText.split(/\r?\n/).find((entry) => /^\s*EXPO_PUBLIC_API_URL\s*=/.test(entry));
  if (!line) {
    throw new Error("EXPO_PUBLIC_API_URL is missing from apps/mobile/.env.");
  }

  const value = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  try {
    return new URL(value);
  } catch {
    throw new Error("EXPO_PUBLIC_API_URL must be a valid absolute HTTP(S) URL.");
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
  }
}

runTypecheck("API TypeScript", ["--filter", "@anyskill/api", "typecheck"]);
runTypecheck("Mobile TypeScript", ["--filter", "@anyskill/mobile", "typecheck"]);

try {
  const configuredUrl = readMobileApiUrl();
  if (configuredUrl.protocol !== "http:" && configuredUrl.protocol !== "https:") {
    throw new Error("EXPO_PUBLIC_API_URL must use HTTP or HTTPS.");
  }

  const apiPath = configuredUrl.pathname.replace(/\/+$/, "");
  const healthPath = `${apiPath}/health`.replace(/\/{2,}/g, "/");

  const localhostUrl = new URL(configuredUrl);
  localhostUrl.hostname = "localhost";
  localhostUrl.pathname = healthPath;
  localhostUrl.search = "";
  localhostUrl.hash = "";

  const lanUrl = new URL(configuredUrl);
  lanUrl.pathname = healthPath;
  lanUrl.search = "";
  lanUrl.hash = "";

  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (loopbackHosts.has(lanUrl.hostname.toLowerCase())) {
    throw new Error("EXPO_PUBLIC_API_URL currently points to localhost. Set it to this computer's LAN IP so both localhost and LAN can be checked.");
  }

  await checkHealth("Localhost API", localhostUrl);
  await checkHealth("Configured LAN API", lanUrl);
} catch (error) {
  failed = true;
  console.error(`\n✗ Health-check setup failed: ${error.message}`);
}

console.log(failed ? "\nCHECK FAILED — review the errors above." : "\nALL CHECKS PASSED.");
process.exitCode = failed ? 1 : 0;
