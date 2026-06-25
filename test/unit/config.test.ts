import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig, redactKey, userConfigPath } from "../../src/config.js";

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
    writeUserConfig(`api_key = "lin_api_userkey0000"`);
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
