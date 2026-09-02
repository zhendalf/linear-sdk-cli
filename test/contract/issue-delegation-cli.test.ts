import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const BIN = join(import.meta.dir, "..", "..", "src", "bin", "linear.ts");

function run(args: string[]) {
  return spawnSync("bun", ["--no-env-file", BIN, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      LINEAR_API_KEY: "lin_api_contract000000000000",
      NO_COLOR: "1",
    },
  });
}

describe("issue delegation CLI contract", () => {
  it("documents set, clear, preview, read-back, and the external Agent Session effect", () => {
    const result = run(["issue", "delegate", "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--clear");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--full-result");
    expect(result.stdout).toContain("may trigger an Agent Session/webhook");
    expect(result.stdout).toContain("does not");
    expect(result.stdout).toContain("cancel a session that is already running");
  });

  it("rejects an agent together with --clear before any API request", () => {
    const result = run(["issue", "delegate", "TES-1", "Codex", "--clear", "--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: "usage", message: expect.stringContaining("either an agent or --clear") },
    });
  });

  it("rejects dry-run plus full-result as one parseable usage error", () => {
    const result = run(["issue", "delegate", "Codex", "--dry-run", "--full-result", "--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: { message: "Pass either --dry-run or --full-result, not both.", code: "usage" },
    });
  });

  it("keeps create/update set and clear flags mutually exclusive", () => {
    for (const args of [
      ["issue", "create", "--title", "t", "--delegate", "Codex", "--clear-delegate"],
      ["issue", "update", "TES-1", "--delegate", "Codex", "--clear-delegate"],
    ]) {
      const result = run([...args, "--json"]);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error.code).toBe("usage");
    }
  });
});
