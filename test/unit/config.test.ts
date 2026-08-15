import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  openSync,
  closeSync,
  statSync,
  chmodSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveConfig,
  redactKey,
  userConfigPath,
  writeCredential,
  setDefaultWorkspace,
  removeCredential,
  listCredentials,
} from "../../src/config.js";
import { createClient } from "../../src/client.js";
import { readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";

let root: string;
let xdg: string;
let projectDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lincfg-"));
  xdg = join(root, "xdg");
  projectDir = join(root, "proj", "nested");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(join(xdg, "linear"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const baseEnv = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  XDG_CONFIG_HOME: xdg,
  HOME: root,
  ...over,
});

function writeUserConfig(body: string) {
  writeFileSync(userConfigPath(baseEnv()), body);
}

function writeProjectConfig(dir: string, body: string) {
  writeFileSync(join(dir, ".linear.toml"), body);
}

describe("resolveConfig precedence", () => {
  it("prefers flag over env over user config for the api key", () => {
    // The only configured workspace supplies the user-config key.
    writeUserConfig(`[workspaces."solo"]\napi_key = "lin_api_userkey0000"`);
    const env = baseEnv({ LINEAR_API_KEY: "lin_api_envkey00000" });
    expect(resolveConfig({ env, flags: { apiKey: "lin_api_flagkey0000" } }).apiKey).toBe(
      "lin_api_flagkey0000",
    );
    expect(resolveConfig({ env }).apiKey).toBe("lin_api_envkey00000");
    expect(resolveConfig({ env: baseEnv() }).apiKey).toBe("lin_api_userkey0000");
  });

  it("reports the api key source", () => {
    expect(resolveConfig({ env: baseEnv({ LINEAR_API_KEY: "x" }) }).apiKeySource).toBe("env");
    expect(resolveConfig({ env: baseEnv(), flags: { apiKey: "x" } }).apiKeySource).toBe("flag");
    expect(resolveConfig({ env: baseEnv() }).apiKeySource).toBe("none");
  });

  it("NEVER reads the api key from a project .linear.toml", () => {
    writeProjectConfig(projectDir, `api_key = "lin_api_projectkey00"\nteam = "TES"`);
    const cfg = resolveConfig({ env: baseEnv(), cwd: projectDir });
    expect(cfg.apiKey).toBeUndefined();
    // but non-secret settings ARE read from the project file
    expect(cfg.team).toBe("TES");
  });

  it("walks ancestors to find the project config", () => {
    writeProjectConfig(join(root, "proj"), `team = "ENG"`);
    const cfg = resolveConfig({ env: baseEnv(), cwd: projectDir });
    expect(cfg.team).toBe("ENG");
    expect(cfg.projectConfigPath).toBe(join(root, "proj", ".linear.toml"));
  });

  it("env overrides project for non-secret settings", () => {
    writeProjectConfig(projectDir, `team = "PROJ"`);
    const cfg = resolveConfig({ env: baseEnv({ LINEAR_TEAM: "ENVTEAM" }), cwd: projectDir });
    expect(cfg.team).toBe("ENVTEAM");
  });

  it("applies sensible defaults", () => {
    const cfg = resolveConfig({ env: baseEnv() });
    expect(cfg.sort).toBe("priority");
    expect(cfg.vcs).toBe("git");
  });
});

describe("multi-workspace credential resolution", () => {
  function writeWorkspaces(body: string) {
    writeUserConfig(body);
  }

  it("selects credential by --workspace flag", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\n` +
        `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n` +
        `[workspaces."org-b"]\napi_key = "lin_api_b000000000"\n`,
    );
    const cfg = resolveConfig({ env: baseEnv(), flags: { workspace: "org-b" } });
    expect(cfg.apiKey).toBe("lin_api_b000000000");
    expect(cfg.credentialWorkspace).toBe("org-b");
    expect(cfg.apiKeySource).toBe("user");
  });

  it("selects credential by LINEAR_WORKSPACE env over default", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\n` +
        `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n` +
        `[workspaces."org-b"]\napi_key = "lin_api_b000000000"\n`,
    );
    const cfg = resolveConfig({ env: baseEnv({ LINEAR_WORKSPACE: "org-b" }) });
    expect(cfg.apiKey).toBe("lin_api_b000000000");
    expect(cfg.credentialWorkspace).toBe("org-b");
  });

  it("falls back to default_workspace when nothing else selects", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\n` +
        `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n` +
        `[workspaces."org-b"]\napi_key = "lin_api_b000000000"\n`,
    );
    const cfg = resolveConfig({ env: baseEnv() });
    expect(cfg.apiKey).toBe("lin_api_a000000000");
    expect(cfg.credentialWorkspace).toBe("org-a");
  });

  it("uses the only workspace when exactly one exists and no default", () => {
    writeWorkspaces(`[workspaces."solo"]\napi_key = "lin_api_solo000000"\n`);
    const cfg = resolveConfig({ env: baseEnv() });
    expect(cfg.apiKey).toBe("lin_api_solo000000");
    expect(cfg.credentialWorkspace).toBe("solo");
  });

  it("does NOT throw when multiple workspaces exist but none is selected", () => {
    writeWorkspaces(
      `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n` +
        `[workspaces."org-b"]\napi_key = "lin_api_b000000000"\n`,
    );
    // Resolution is total: no throw, key undefined, deferred error stashed.
    const cfg = resolveConfig({ env: baseEnv() });
    expect(cfg.apiKey).toBeUndefined();
    expect(cfg.apiKeyError?.message).toMatch(/Multiple workspaces/);
    // createClient surfaces the deferred error only when a client is needed.
    expect(() => createClient(cfg)).toThrow(/Multiple workspaces/);
  });

  it("does NOT throw when a selected workspace is not stored (so auth login --workspace new works)", () => {
    writeWorkspaces(`[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n`);
    // flag selection
    const byFlag = resolveConfig({ env: baseEnv(), flags: { workspace: "new-org" } });
    expect(byFlag.apiKey).toBeUndefined();
    expect(byFlag.apiKeyError?.message).toMatch(/No stored credential for workspace 'new-org'/);
    expect(() => createClient(byFlag)).toThrow(/No stored credential/);
    // env selection
    const byEnv = resolveConfig({ env: baseEnv({ LINEAR_WORKSPACE: "ghost" }) });
    expect(byEnv.apiKey).toBeUndefined();
    expect(byEnv.apiKeyError?.message).toMatch(/No stored credential for workspace 'ghost'/);
  });

  it("flag api key bypasses workspace selection entirely", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\n[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n`,
    );
    const cfg = resolveConfig({
      env: baseEnv(),
      flags: { apiKey: "lin_api_flag0000000", workspace: "org-a" },
    });
    expect(cfg.apiKey).toBe("lin_api_flag0000000");
    expect(cfg.apiKeySource).toBe("flag");
    expect(cfg.credentialWorkspace).toBeUndefined();
  });

  it("env api key bypasses workspace selection entirely", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\n[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n`,
    );
    const cfg = resolveConfig({ env: baseEnv({ LINEAR_API_KEY: "lin_api_env00000000" }) });
    expect(cfg.apiKey).toBe("lin_api_env00000000");
    expect(cfg.apiKeySource).toBe("env");
    expect(cfg.credentialWorkspace).toBeUndefined();
  });

  it("project config NEVER steers credential workspace selection", () => {
    writeWorkspaces(
      `default_workspace = "org-a"\n` +
        `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n` +
        `[workspaces."org-b"]\napi_key = "lin_api_b000000000"\n`,
    );
    // A project file claiming workspace=org-b must not change the credential.
    writeProjectConfig(projectDir, `workspace = "org-b"`);
    const cfg = resolveConfig({ env: baseEnv(), cwd: projectDir });
    expect(cfg.apiKey).toBe("lin_api_a000000000");
    expect(cfg.credentialWorkspace).toBe("org-a");
    // ...but it does affect the non-secret display workspace setting.
    expect(cfg.workspace).toBe("org-b");
  });

  it("--workspace flag still wins the display workspace setting", () => {
    writeWorkspaces(`[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n`);
    writeProjectConfig(projectDir, `workspace = "proj-ws"`);
    const cfg = resolveConfig({ env: baseEnv(), cwd: projectDir, flags: { workspace: "org-a" } });
    expect(cfg.workspace).toBe("org-a");
  });
});

describe("structured credential writers", () => {
  let savedXdg: string | undefined;
  let savedHome: string | undefined;

  beforeEach(() => {
    // The writers read the real process.env, so point it at the temp dir.
    savedXdg = process.env.XDG_CONFIG_HOME;
    savedHome = process.env.HOME;
    process.env.XDG_CONFIG_HOME = xdg;
    process.env.HOME = root;
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });

  function readBack(): Record<string, any> {
    return parseToml(readFileSync(userConfigPath(baseEnv()), "utf8")) as Record<string, any>;
  }

  it("writeCredential upserts and sets default when none exists", () => {
    writeCredential("my-org", "lin_api_first00000");
    const obj = readBack();
    expect(obj.default_workspace).toBe("my-org");
    expect(obj.workspaces["my-org"].api_key).toBe("lin_api_first00000");
  });

  it("writeCredential preserves other workspaces and top-level settings", () => {
    writeUserConfig(
      `default_workspace = "org-a"\nteam = "TES"\nsort = "updated"\n` +
        `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n`,
    );
    writeCredential("org-b", "lin_api_b000000000");
    const obj = readBack();
    expect(obj.default_workspace).toBe("org-a"); // unchanged
    expect(obj.team).toBe("TES");
    expect(obj.sort).toBe("updated");
    expect(obj.workspaces["org-a"].api_key).toBe("lin_api_a000000000");
    expect(obj.workspaces["org-b"].api_key).toBe("lin_api_b000000000");
  });

  it("round-trips quoted hyphenated slugs through resolveConfig", () => {
    writeCredential("acme-corp", "lin_api_acme000000");
    const cfg = resolveConfig({ env: baseEnv(), flags: { workspace: "acme-corp" } });
    expect(cfg.apiKey).toBe("lin_api_acme000000");
    expect(cfg.credentialWorkspace).toBe("acme-corp");
  });

  it("round-trips slugs needing real quoting (dots)", () => {
    writeCredential("co.uk-org", "lin_api_couk000000");
    const cfg = resolveConfig({ env: baseEnv(), flags: { workspace: "co.uk-org" } });
    expect(cfg.apiKey).toBe("lin_api_couk000000");
  });

  it("setDefaultWorkspace updates the default", () => {
    writeCredential("org-a", "lin_api_a000000000");
    writeCredential("org-b", "lin_api_b000000000");
    setDefaultWorkspace("org-b");
    expect(readBack().default_workspace).toBe("org-b");
  });

  it("setDefaultWorkspace errors for an unconfigured workspace", () => {
    writeCredential("org-a", "lin_api_a000000000");
    expect(() => setDefaultWorkspace("ghost")).toThrow(/not configured/);
  });

  it("removeCredential removes only the target workspace", () => {
    writeCredential("org-a", "lin_api_a000000000");
    writeCredential("org-b", "lin_api_b000000000");
    expect(removeCredential("org-a")).toBe(true);
    const obj = readBack();
    expect(obj.workspaces["org-a"]).toBeUndefined();
    expect(obj.workspaces["org-b"].api_key).toBe("lin_api_b000000000");
  });

  it("removeCredential repoints the default when removing the default", () => {
    writeCredential("org-a", "lin_api_a000000000"); // becomes default
    writeCredential("org-b", "lin_api_b000000000");
    removeCredential("org-a");
    expect(readBack().default_workspace).toBe("org-b");
  });

  it("removeCredential clears default_workspace when removing the last workspace", () => {
    writeCredential("solo", "lin_api_solo000000");
    expect(removeCredential("solo")).toBe(true);
    const obj = readBack();
    expect(obj.default_workspace).toBeUndefined();
    expect(obj.workspaces).toBeUndefined();
  });

  it("removeCredential returns false for an unknown workspace", () => {
    writeCredential("org-a", "lin_api_a000000000");
    expect(removeCredential("ghost")).toBe(false);
  });

  it("listCredentials shows one entry per workspace with the default flag", () => {
    writeUserConfig(
      `default_workspace = "org-a"\n` +
        `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n` +
        `[workspaces."org-b"]\napi_key = "lin_api_b000000000"\n`,
    );
    const list = listCredentials(baseEnv());
    expect(list).toHaveLength(2);
    expect(list.find((e) => e.slug === "org-a")?.isDefault).toBe(true);
    expect(list.find((e) => e.slug === "org-b")?.isDefault).toBe(false);
  });
});

describe("config parse errors never quote the file", () => {
  const SECRET = "lin_api_SUPERSECRETVALUE";

  it("does not echo a truncated api_key line (the secret) into the error", () => {
    // A file that got truncated mid-credential: smol-toml's own message embeds
    // the offending source line, which would print the key to stderr.
    writeUserConfig(`default_workspace = "org"\n[workspaces."org"]\napi_key = "${SECRET}\n`);
    let message = "";
    try {
      resolveConfig({ env: baseEnv() });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/Failed to parse config at/);
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("api_key");
    // Still actionable: the reason and the position survive.
    expect(message).toMatch(/control characters are not allowed in strings/);
    expect(message).toMatch(/\(line 3, column \d+\)/);
  });

  it("strips control characters a project .linear.toml tries to inject", () => {
    const esc = String.fromCharCode(27);
    // A project file is not trusted: raw ANSI would let it repaint or clear the
    // user's terminal through our error output.
    writeProjectConfig(projectDir, `team = "${esc}[31mPWNED${esc}[2J unterminated\n`);
    let message = "";
    try {
      resolveConfig({ env: baseEnv(), cwd: projectDir });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/Failed to parse config at/);
    expect(message).not.toContain(esc);
    expect(message).not.toContain("PWNED");
    // eslint-disable-next-line no-control-regex
    expect(message).not.toMatch(new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]"));
  });

  it("caps a pathologically long reason instead of flooding stderr", () => {
    writeUserConfig(`x = ${"9".repeat(5000)}e${"9".repeat(5000)}\n`);
    let message = "";
    try {
      resolveConfig({ env: baseEnv() });
    } catch (err) {
      message = (err as Error).message;
    }
    // path + reason(<=200) + position — nowhere near the 10k source line.
    expect(message.length).toBeLessThan(1000);
  });
});

describe("credential writes are atomic", () => {
  let savedXdg: string | undefined;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedXdg = process.env.XDG_CONFIG_HOME;
    savedHome = process.env.HOME;
    process.env.XDG_CONFIG_HOME = xdg;
    process.env.HOME = root;
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });

  it("a reader holding the old file still sees a COMPLETE config after a write", () => {
    writeCredential("org-a", "lin_api_a000000000");
    const path = userConfigPath(baseEnv());
    const before = readFileSync(path, "utf8");

    // A concurrent `linear` process opens the config, then we replace it. An
    // in-place truncate+write would let that reader observe a half-written
    // file; replacing the path by rename cannot.
    const fd = openSync(path, "r");
    try {
      writeCredential("org-b", "lin_api_b000000000");
      const seen = readFileSync(fd, "utf8");
      expect(seen).toBe(before);
      expect(parseToml(seen)).toBeTruthy();
    } finally {
      closeSync(fd);
    }

    // ...and the new content did land.
    expect((parseToml(readFileSync(path, "utf8")) as any).workspaces["org-b"].api_key).toBe(
      "lin_api_b000000000",
    );
  });

  it("the replacement is a new file, not a rewrite of the old inode", () => {
    writeCredential("org-a", "lin_api_a000000000");
    const path = userConfigPath(baseEnv());
    const first = statSync(path).ino;
    writeCredential("org-b", "lin_api_b000000000");
    expect(statSync(path).ino).not.toBe(first);
  });

  it("leaves no temp files behind", () => {
    writeCredential("org-a", "lin_api_a000000000");
    writeCredential("org-b", "lin_api_b000000000");
    setDefaultWorkspace("org-b");
    removeCredential("org-a");
    expect(readdirSync(join(xdg, "linear"))).toEqual(["config.toml"]);
  });

  it("keeps the credential file at 0600, tightening one that was loosened", () => {
    writeCredential("org-a", "lin_api_a000000000");
    const path = userConfigPath(baseEnv());
    expect(statSync(path).mode & 0o777).toBe(0o600);

    chmodSync(path, 0o644);
    writeCredential("org-b", "lin_api_b000000000");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

});

describe("redactKey", () => {
  it("keeps the lin_api_ prefix and last 4", () => {
    expect(redactKey("lin_api_ABCDEFGHIJKLMNOP")).toBe("lin_api_••••MNOP");
  });
  it("handles missing key", () => {
    expect(redactKey(undefined)).toBe("(not set)");
  });
  it("fully masks short keys", () => {
    expect(redactKey("short")).toBe("••••");
  });
});
