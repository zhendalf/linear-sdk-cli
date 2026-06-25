/**
 * Helpers for live integration tests. These spawn the built CLI binary
 * (true end-to-end) against the designated test workspace and parse --json.
 *
 * Gated by LINEAR_CLI_LIVE=1 and a LINEAR_API_KEY. Admin-tier suites also
 * require LINEAR_CLI_LIVE_ADMIN=1.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
export const BIN = join(here, "..", "..", "dist", "bin", "linear.js");

/** A stable, identifiable prefix so leaked fixtures are easy to sweep. */
export const FIXTURE_PREFIX = `clitest-${process.env.LINEAR_CLI_RUN_ID || "local"}-`;

export const LIVE = !!process.env.LINEAR_CLI_LIVE && !!process.env.LINEAR_API_KEY;
export const LIVE_ADMIN = LIVE && !!process.env.LINEAR_CLI_LIVE_ADMIN;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function ensureBuilt(): void {
  if (!existsSync(BIN)) {
    throw new Error(`CLI not built at ${BIN}. Run \`pnpm build\` first (test:live does this).`);
  }
}

/** Run the CLI; never throws on non-zero exit — returns the captured result. */
export function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync("node", [BIN, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err: any) {
    return {
      code: typeof err.status === "number" ? err.status : 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

/** Run with --json appended and parse stdout. Throws if the command failed. */
export function runJson<T = any>(args: string[]): T {
  const res = run([...args, "--json"]);
  if (res.code !== 0) {
    throw new Error(`CLI failed (${res.code}): ${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout) as T;
}
