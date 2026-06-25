/**
 * Configuration resolution.
 *
 * Two tiers with different trust boundaries:
 *  - Non-secret settings (team, workspace, sort, vcs): flag > env > project
 *    .linear.toml (cwd→ancestors) > user config.
 *  - The API key has a STRICTER boundary and is never read from a project file
 *    (avoids committing secrets): flag > LINEAR_API_KEY env > user config.
 */

import { homedir } from "node:os";
import { join, dirname, parse as parsePath } from "node:path";
import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { CliError } from "./lib/errors.js";

export interface RawSettings {
  team?: string;
  workspace?: string;
  sort?: string;
  vcs?: string;
  apiKey?: string;
}

export type ConfigSource = "flag" | "env" | "project" | "user" | "none";

export interface ResolvedConfig {
  apiKey?: string;
  apiKeySource: ConfigSource;
  team?: string;
  workspace?: string;
  sort: string;
  vcs: string;
  /** Absolute path of the user config file (may not exist yet). */
  userConfigPath: string;
  /** Project .linear.toml path that was loaded, if any. */
  projectConfigPath?: string;
}

export interface ConfigInputs {
  /** CLI flag overrides. */
  flags?: Partial<RawSettings>;
  /** Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to process.cwd(). */
  cwd?: string;
}

const USER_CONFIG_FILE = "config.toml";

/** Resolve the user config path lazily so tests can override XDG_CONFIG_HOME/HOME. */
export function userConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(base, "linear", USER_CONFIG_FILE);
}

function readTomlFile(path: string): RawSettings {
  try {
    const parsed = parseToml(readFileSync(path, "utf8")) as Record<string, unknown>;
    return {
      team: asString(parsed.team ?? parsed.team_id),
      workspace: asString(parsed.workspace),
      sort: asString(parsed.sort ?? parsed.issue_sort),
      vcs: asString(parsed.vcs),
      apiKey: asString(parsed.api_key ?? parsed.apiKey),
    };
  } catch (err) {
    throw new CliError(
      `Failed to parse config at ${path}: ${(err as Error).message}`,
      "runtime",
    );
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Walk from cwd up to filesystem root collecting the first `.linear.toml`. */
function findProjectConfig(cwd: string): string | undefined {
  let dir = cwd;
  const { root } = parsePath(dir);
  // Bound the walk so a pathological symlink loop can't spin forever.
  for (let i = 0; i < 64; i++) {
    const candidate = join(dir, ".linear.toml");
    if (existsSync(candidate)) return candidate;
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Read env vars into a settings object (only the keys we recognize). */
function fromEnv(env: NodeJS.ProcessEnv): RawSettings {
  return {
    apiKey: env.LINEAR_API_KEY || env.LINEAR_API_TOKEN,
    team: env.LINEAR_TEAM || env.LINEAR_TEAM_ID,
    workspace: env.LINEAR_WORKSPACE,
    sort: env.LINEAR_ISSUE_SORT,
    vcs: env.LINEAR_VCS,
  };
}

export function resolveConfig(inputs: ConfigInputs = {}): ResolvedConfig {
  const env = inputs.env ?? process.env;
  const cwd = inputs.cwd ?? process.cwd();
  const flags = inputs.flags ?? {};

  const envSettings = fromEnv(env);
  const userPath = userConfigPath(env);
  const userSettings = existsSync(userPath) ? readTomlFile(userPath) : {};
  const projectPath = findProjectConfig(cwd);
  const projectSettings = projectPath ? readTomlFile(projectPath) : {};

  // API key: flag > env > user config ONLY (never project).
  let apiKey: string | undefined;
  let apiKeySource: ConfigSource = "none";
  if (flags.apiKey) {
    apiKey = flags.apiKey;
    apiKeySource = "flag";
  } else if (envSettings.apiKey) {
    apiKey = envSettings.apiKey;
    apiKeySource = "env";
  } else if (userSettings.apiKey) {
    apiKey = userSettings.apiKey;
    apiKeySource = "user";
  }

  const pick = <K extends keyof RawSettings>(key: K): string | undefined =>
    flags[key] ?? envSettings[key] ?? projectSettings[key] ?? userSettings[key];

  return {
    apiKey,
    apiKeySource,
    team: pick("team"),
    workspace: pick("workspace"),
    sort: pick("sort") ?? "priority",
    vcs: pick("vcs") ?? "git",
    userConfigPath: userPath,
    projectConfigPath: projectPath,
  };
}

/** Persist the API key to the user config file with 0600 perms. */
export function writeApiKey(apiKey: string): string {
  const path = userConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  // Preserve any existing non-secret settings in the user file.
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const withoutKey = existing
    .split("\n")
    .filter((l) => !/^\s*api_key\s*=/.test(l) && !/^\s*apiKey\s*=/.test(l))
    .join("\n")
    .trim();
  const body = [`api_key = ${JSON.stringify(apiKey)}`, withoutKey].filter(Boolean).join("\n");
  writeFileSync(path, body + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/** Remove the stored API key from user config (used by `auth logout`). */
export function clearApiKey(): boolean {
  const path = userConfigPath();
  if (!existsSync(path)) return false;
  const existing = readFileSync(path, "utf8");
  const withoutKey = existing
    .split("\n")
    .filter((l) => !/^\s*api_key\s*=/.test(l) && !/^\s*apiKey\s*=/.test(l))
    .join("\n")
    .trim();
  writeFileSync(path, withoutKey ? withoutKey + "\n" : "", { mode: 0o600 });
  return true;
}

/** Redact a secret for display: keep the prefix and last 4 chars. */
export function redactKey(key: string | undefined): string {
  if (!key) return "(not set)";
  if (key.length <= 12) return "••••";
  const prefix = key.startsWith("lin_api_") ? "lin_api_" : key.slice(0, 4);
  return `${prefix}••••${key.slice(-4)}`;
}
