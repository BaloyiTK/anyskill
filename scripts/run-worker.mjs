import { spawn } from "node:child_process";

const development = process.argv[2] === "dev";
const script = development ? "start:worker:dev" : "start:worker";
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const child = spawn(command, ["--filter", "@anyskill/api", script], {
  env: { ...process.env, ANYSKILL_PROCESS_ROLE: "worker" },
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.once("error", (error) => {
  process.stderr.write(`[AnySkillWorkerLauncher] Could not start pnpm: ${error.message}\n`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
