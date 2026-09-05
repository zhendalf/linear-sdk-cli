import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createProgram } from "../../src/cli.js";
import { userConfigPath } from "../../src/config.js";
import { setAuthValidationClientFactoryForTests } from "../../src/commands/meta.js";
import { memoryKeyring, setKeyringBackend } from "../../src/lib/keyring.js";

const bin = resolve(import.meta.dir, "../../src/bin/linear.ts");
const envKeys = [
  "HOME",
  "XDG_CONFIG_HOME",
  "LINEAR_API_KEY",
  "LINEAR_API_TOKEN",
  "LINEAR_ACCESS_TOKEN",
  "LINEAR_WORKSPACE",
];
let savedEnv: Record<string, string | undefined>;
let root: string;
let cwd: string;

beforeEach(() => {
  savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  root = realpathSync(mkdtempSync(join(tmpdir(), "lin-auth-contract-")));
  cwd = process.cwd();
  process.chdir(root);
  process.env.HOME = root;
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  mkdirSync(join(root, "xdg", "linear"), { recursive: true });
  setKeyringBackend(memoryKeyring());
  setAuthValidationClientFactoryForTests(() => ({
    viewer: Promise.resolve({ id: "u", name: "Ada", email: "ada@example.com" }),
    organization: Promise.resolve({ id: "o", name: "Acme", urlKey: "acme" }),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  setAuthValidationClientFactoryForTests(undefined);
  setKeyringBackend(undefined);
  process.chdir(cwd);
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(root, { recursive: true, force: true });
});

async function run(args: string[]) {
  let stdout = "";
  let stderr = "";
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    stdout += chunk;
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    stderr += chunk;
    return true;
  });
  try {
    await createProgram().parseAsync(["node", "linear", ...args]);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return { stdout, stderr };
}

describe("auth workspace output contract", () => {
  it("reports the project association in secret-safe JSON and human output", async () => {
    const result = await run(["auth", "login", "--key", "lin_api_secret", "--json"]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      success: true,
      workspace: "acme",
      projectConfigPath: join(root, ".linear.toml"),
    });
    expect(result.stdout + result.stderr).not.toContain("lin_api_secret");
    expect(readFileSync(join(root, ".linear.toml"), "utf8")).toBe('workspace = "acme"\n');
    const human = await run(["auth", "login", "--key", "lin_api_secret"]);
    expect(human.stdout + human.stderr).toContain(
      `Project workspace saved to ${join(root, ".linear.toml")}`,
    );
    const skipped = await run([
      "auth",
      "login",
      "--key",
      "lin_api_secret",
      "--no-project",
      "--json",
    ]);
    expect(JSON.parse(skipped.stdout).projectConfigPath).toBeNull();
  });

  for (const command of [["whoami"], ["auth", "token"], ["auth", "status"]]) {
    it(`${command.join(" ")} fails with a parseable JSON error when selection is ambiguous`, () => {
      writeFileSync(
        userConfigPath(),
        '[workspaces.a]\napi_key = "lin_api_a"\n[workspaces.b]\napi_key = "lin_api_b"\n',
      );
      const result = spawnSync("bun", ["--no-env-file", bin, ...command, "--json"], {
        cwd: root,
        env: process.env,
        encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      const envelope = JSON.parse(result.stderr);
      expect(JSON.stringify(envelope)).toContain("none is selected");
      expect(JSON.stringify(envelope)).toContain("--workspace");
      expect(result.stdout + result.stderr).not.toContain("lin_api_");
    });
  }
});
