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

describe("issue label-group CLI contract", () => {
  it("documents repeatable group replacement, quoting, first-equals parsing, and concurrency", () => {
    const result = run(["issue", "label", "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--set-group <group=label>");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--full-result");
    expect(result.stdout).toContain("splits on the first '='");
    expect(result.stdout).toContain("Quote the whole value");
    expect(result.stdout).toContain("group name itself contains '='");
    expect(result.stdout).toContain("another change to the same");
    expect(result.stdout).toContain("group can race");
  });

  it("rejects malformed GROUP=LABEL before an API request", () => {
    const result = run(["issue", "label", "TES-1", "--set-group", "Team", "--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        message:
          "Expected GROUP=LABEL for --set-group, got 'Team'. Quote the whole assignment when it contains spaces.",
        code: "usage",
      },
    });
  });

  it("rejects set-group mixed with legacy add/remove deterministically", () => {
    for (const legacy of ["--add", "--remove"]) {
      const result = run([
        "issue",
        "label",
        "TES-1",
        "--set-group",
        "Team=QA",
        legacy,
        "bug",
        "--json",
      ]);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({
        error: {
          message: "Pass either --set-group or --add/--remove, not both.",
          code: "usage",
        },
      });
    }
  });

  it("rejects dry-run plus full-result as one parseable usage error", () => {
    const result = run([
      "issue",
      "label",
      "TES-1",
      "--set-group",
      "Team=QA",
      "--dry-run",
      "--full-result",
      "--json",
    ]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: { message: "Pass either --dry-run or --full-result, not both.", code: "usage" },
    });
  });

  it("keeps dry-run/full-result scoped to set-group", () => {
    const result = run(["issue", "label", "TES-1", "--add", "bug", "--dry-run", "--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toEqual({
      message: "--dry-run/--full-result currently require --set-group.",
      code: "usage",
    });
  });
});
