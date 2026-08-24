/**
 * The `config` command group: `show` (the default), `init`, `set` — against a
 * scratch git repository and an isolated user config, no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../../src/cli.js";
import { userConfigPath } from "../../src/config.js";
import { memoryKeyring, setKeyringBackend } from "../../src/lib/keyring.js";

let root: string;
let repo: string;
let sub: string;
let savedCwd: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lincfgcmd-")));
  repo = join(root, "repo");
  sub = join(repo, "pkg", "deep");
  mkdirSync(sub, { recursive: true });
  mkdirSync(join(root, "xdg", "linear"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  savedCwd = process.cwd();
  process.chdir(sub);
  savedEnv = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, HOME: process.env.HOME };
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  process.env.HOME = root;
  setKeyringBackend(memoryKeyring());
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(savedCwd);
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setKeyringBackend(undefined);
  rmSync(root, { recursive: true, force: true });
});

async function runJson(args: string[]): Promise<any> {
  let out = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
    out += c;
    return true;
  });
  try {
    await createProgram().parseAsync(["node", "linear", ...args, "--json"]);
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(out);
}
const run = (args: string[]) => createProgram().parseAsync(["node", "linear", ...args, "--json"]);

describe("config init", () => {
  it("writes <git root>/.linear.toml from a subdirectory, and the repo sees it", async () => {
    const out = await runJson(["config", "init", "--team", "tes", "--sort", "updated"]);
    const path = join(repo, ".linear.toml");
    expect(out).toEqual({ success: true, path, team: "TES", sort: "updated" });
    expect(readFileSync(path, "utf8")).toContain('team = "TES"');
    const shown = await runJson(["config"]);
    expect(shown.team).toBe("TES");
    expect(shown.sort).toBe("updated");
    expect(shown.origins.team).toEqual({ source: "project", path, key: "team" });
  });

  it("without --team and without a terminal, says how to proceed instead of prompting", async () => {
    await expect(run(["config", "init"])).rejects.toThrow(/Pass --team <key>/);
    expect(existsSync(join(repo, ".linear.toml"))).toBe(false);
  });

  it("refuses to overwrite unless --force, and --path picks the file", async () => {
    await run(["config", "init", "--team", "TES"]);
    await expect(run(["config", "init", "--team", "ENG"])).rejects.toThrow(/already exists/);
    await run(["config", "init", "--team", "ENG", "--force"]);
    expect(readFileSync(join(repo, ".linear.toml"), "utf8")).toContain('team = "ENG"');
    const other = join(sub, "linear.toml");
    const out = await runJson(["config", "init", "--team", "QA", "--path", other]);
    expect(out.path).toBe(other);
    // The nearer file now wins for this directory.
    expect((await runJson(["config"])).team).toBe("QA");
  });

  it("validates values the way the reader will", async () => {
    await run(["config", "init", "--team", "TES", "--sort", "manual"]);
    expect(readFileSync(join(repo, ".linear.toml"), "utf8")).toContain('sort = "manual"');
    await expect(run(["config", "init", "--team", "not a key"])).rejects.toThrow(/team key/);
  });
});

describe("config set", () => {
  it("edits the project config in effect — wherever discovery found it", async () => {
    // A schpet-style file at the git root: `set` changes it, in its spelling.
    mkdirSync(join(repo, ".config"));
    const path = join(repo, ".config", "linear.toml");
    writeFileSync(path, `# linear cli\nteam_id = "TES"\n`);
    const out = await runJson(["config", "set", "team", "eng"]);
    expect(out).toEqual({ success: true, path, key: "team_id", value: "ENG" });
    expect(readFileSync(path, "utf8")).toBe(`# linear cli\nteam_id = "ENG"\n`);
  });

  it("creates <git root>/.linear.toml when there is no project config yet", async () => {
    const out = await runJson(["config", "set", "sort", "created"]);
    expect(out.path).toBe(join(repo, ".linear.toml"));
    expect((await runJson(["config"])).sort).toBe("created");
  });

  it("--user writes the user config and keeps it 0600 with its credentials intact", async () => {
    writeFileSync(userConfigPath(), `[workspaces.acme]\napi_key = "lin_api_secret00000"\n`);
    const out = await runJson(["config", "set", "team", "TES", "--user"]);
    expect(out.path).toBe(userConfigPath());
    const text = readFileSync(userConfigPath(), "utf8");
    expect(text).toContain('team = "TES"');
    expect(text).toContain('api_key = "lin_api_secret00000"');
    expect((await runJson(["auth", "status"])).authenticated).toBe(true);
    expect((await runJson(["config"])).origins.team.source).toBe("user");
  });

  it("refuses secrets, unknown keys, bad values, and --user with --path", async () => {
    await expect(run(["config", "set", "api_key", "lin_api_x"])).rejects.toThrow(
      /not a project setting/,
    );
    await expect(run(["config", "set", "colour", "blue"])).rejects.toThrow(/Unknown setting/);
    await expect(run(["config", "set", "vcs", "svn"])).rejects.toThrow(/Unknown setting/);
    await expect(
      run(["config", "set", "team", "TES", "--user", "--path", "x.toml"]),
    ).rejects.toThrow(/--user or --path/);
    expect(existsSync(join(repo, ".linear.toml"))).toBe(false);
  });
});

describe("config (show)", () => {
  it("is still the bare `linear config`, and appears as `config show` too", async () => {
    const bare = await runJson(["config"]);
    const show = await runJson(["config", "show"]);
    expect(show).toEqual(bare);
    expect(bare).toHaveProperty("origins");
    expect(bare).toHaveProperty("globalConfigPath", null);
  });
});
