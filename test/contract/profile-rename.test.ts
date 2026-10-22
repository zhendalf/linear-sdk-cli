import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createProgram } from "../../src/cli.js";
import { userConfigPath } from "../../src/config.js";
import { setAuthValidationClientFactoryForTests } from "../../src/commands/meta.js";
import { memoryKeyring, setKeyringBackend } from "../../src/lib/keyring.js";

const bin = resolve(import.meta.dir, "../../src/bin/linear.ts");
let saved: NodeJS.ProcessEnv;
let root: string;
let cwd: string;
const secret = "lin_api_fixture_rename_secret";

beforeEach(() => {
  saved = { ...process.env };
  for (const key of Object.keys(process.env))
    if (key.startsWith("LINEAR_")) delete process.env[key];
  root = realpathSync(mkdtempSync(join(tmpdir(), "lin-rename-contract-")));
  cwd = process.cwd();
  process.chdir(root);
  process.env.HOME = root;
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  mkdirSync(join(root, "xdg", "linear"), { recursive: true });
  setKeyringBackend(memoryKeyring({ old: secret }));
  writeFileSync(userConfigPath(), '[workspaces.old]\nkeyring = true\nteam = "ENG"\n');
  setAuthValidationClientFactoryForTests((key, kind) => {
    expect(key).toBe(secret);
    expect(kind).toBe("api-key");
    return {
      viewer: Promise.resolve({ id: "user", name: "Ada", email: "ada@example.com" }),
      organization: Promise.resolve({ id: "organization", name: "Example", urlKey: "new" }),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  setAuthValidationClientFactoryForTests(undefined);
  setKeyringBackend(undefined);
  process.chdir(cwd);
  process.env = saved;
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
    await createProgram().parseAsync(["bun", "linear", ...args]);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return { stdout, stderr };
}

describe("auth rename contract", () => {
  it("reports secret-free JSON and every checked project needing an update without editing them", async () => {
    const current = join(root, ".linear.toml");
    const extra = join(root, "another.toml");
    const unaffected = join(root, "unaffected.toml");
    const global = join(root, "xdg", "linear", "linear.toml");
    const text = '# preserve project comments\nworkspace = "old"\nteam = "ENG"\n';
    writeFileSync(current, text);
    writeFileSync(extra, text);
    writeFileSync(unaffected, 'workspace = "other"\n');
    writeFileSync(global, 'workspace = "old"\n');
    process.env.LINEAR_API_KEY = "ambient-key-must-not-be-used";
    const result = await run([
      "auth",
      "rename",
      "old",
      "new",
      "--project-config",
      extra,
      unaffected,
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data).toMatchObject({
      success: true,
      from: "old",
      workspace: "new",
      credentialType: "api-key",
      organization: { id: "organization", urlKey: "new" },
      storage: "keychain",
      team: "ENG",
      defaultWorkspace: null,
    });
    expect(data.checkedProjectConfigs).toEqual([current, extra, unaffected]);
    expect(data.projectConfigUpdates).toEqual(
      [current, extra].map((path) => ({ path, key: "workspace", from: "old", to: "new" })),
    );
    expect(data.globalConfigUpdates).toEqual([
      { path: global, key: "workspace", from: "old", to: "new" },
    ]);
    expect(data.otherProjects).toContain("other project configs");
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).not.toContain("ambient-key");
    for (const path of [current, extra]) expect(readFileSync(path, "utf8")).toBe(text);
    expect(readFileSync(global, "utf8")).toBe('workspace = "old"\n');
  });

  it("prints concrete project paths and the remaining search boundary for humans", async () => {
    const current = join(root, ".linear.toml");
    writeFileSync(current, 'workspace = "old"\n');
    const result = await run(["auth", "rename", "old", "new"]);
    expect(result.stdout + result.stderr).toContain("Renamed API-key profile 'old' to 'new'");
    expect(result.stdout + result.stderr).toContain(`Update ${current}: workspace = "new"`);
    expect(result.stdout + result.stderr).toContain("Only the listed project paths were checked");
    expect(result.stdout + result.stderr).not.toContain(secret);
  });

  it("validates the requested current slug and leaves the original profile intact on mismatch", async () => {
    const before = readFileSync(userConfigPath(), "utf8");
    await expect(run(["auth", "rename", "old", "wrong", "--json"])).rejects.toThrow(
      "does not match",
    );
    expect(readFileSync(userConfigPath(), "utf8")).toBe(before);
  });

  it("advertises migration, recovery, OAuth scope and output fields in discovery/help", async () => {
    const commands = JSON.parse((await run(["commands", "auth", "rename", "--json"])).stdout);
    expect(commands.output.fields.projectConfigUpdates).toBeDefined();
    expect(commands.output.fields.organization).toBeDefined();
    let help = "";
    const rename = createProgram()
      .commands.find((cmd) => cmd.name() === "auth")!
      .commands.find((cmd) => cmd.name() === "rename")!;
    rename
      .configureOutput({
        writeOut: (text) => {
          help += text;
        },
      })
      .outputHelp();
    expect(help).toContain("API-key profile");
    expect(help).toContain("resumed by repeating");
    expect(help).toContain("OAuth user/app profiles are not supported");
    expect(help).toContain("--project-config");
  });

  it("refuses injected credential flags and conflicting workspace selection", async () => {
    await expect(run(["auth", "rename", "old", "new", "--api-key", "injected"])).rejects.toThrow(
      "remove credential flags",
    );
    await expect(run(["auth", "rename", "old", "new", "--workspace", "other"])).rejects.toThrow(
      "must match",
    );
  });

  it("preserves JSON error envelopes and exit codes without touching a system keyring", () => {
    writeFileSync(userConfigPath(), `[workspaces.old]\napi_key = "${secret}"\n`);
    const result = spawnSync(
      "bun",
      ["--no-env-file", bin, "auth", "rename", "old", "Invalid", "--json"],
      { cwd: root, env: process.env, encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error.code).toBe("usage");
    expect(result.stderr).not.toContain(secret);
  });
});
