/**
 * Configuration resolution.
 *
 * Two tiers with different trust boundaries:
 *  - Non-secret settings (team, workspace, sort, vcs): flag > env > project
 *    .linear.toml (cwd→ancestors) > user config.
 *  - The API key has a STRICTER boundary and is never read from a project file
 *    (avoids committing secrets): flag > LINEAR_API_KEY env > user config.
 *
 * Multi-workspace credentials live under quoted `[workspaces."<slug>"]` tables
 * in the user config, with an optional top-level `default_workspace`. Credential
 * selection is lazy: resolution never throws, stashing any selection error in
 * `apiKeyError` so it surfaces only when a client is actually needed.
 */

import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { join, dirname, basename, parse as parsePath } from "node:path";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
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
  /**
   * Deferred credential-selection error. Resolution is total (it never throws
   * for selection problems) so commands that REPAIR auth state — `auth list`,
   * `auth default`, `auth logout`, `auth login --workspace new-org` — can still
   * build a Context. The error is surfaced only when an API client is actually
   * needed (see createClient / `auth token`).
   */
  apiKeyError?: CliError;
  /** Workspace slug whose stored credential was used, if any. */
  credentialWorkspace?: string;
  team?: string;
  /** Non-secret display workspace setting (separate from credentialWorkspace). */
  workspace?: string;
  sort: string;
  /** Where `sort` came from, so an invalid value can be blamed precisely. */
  sortSource: ConfigSource;
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

/** Parsed view of the user config: top-level settings + nested workspace creds. */
interface UserConfig {
  /** Top-level non-secret settings. */
  settings: RawSettings;
  /** default_workspace, if set. */
  defaultWorkspace?: string;
  /** slug → api_key from `[workspaces."<slug>"]`. */
  workspaces: Record<string, string>;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Strip control characters so nothing a config file contains can drive the
 * terminal (ANSI escapes, `\r` overwrite tricks) or smuggle bidi overrides into
 * an error message. C0, DEL, C1, and the bidi embedding/override controls —
 * spelled as escapes so no literal control byte lives in this source.
 */
const CONTROL_CHARS = new RegExp(
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u001F\\u007F-\\u009F\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]",
  "g",
);

function sanitize(text: string, max = 200): string {
  const clean = text.replace(CONTROL_CHARS, "");
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

/**
 * Describe a TOML parse failure WITHOUT quoting the file.
 *
 * smol-toml's `message` embeds a code block of the offending lines, so a
 * truncated `api_key = "lin_api_…` line would print the secret to stderr, and a
 * project-controlled `.linear.toml` could inject escape sequences the same way.
 * We keep only the reason (a fixed string from smol-toml's own vocabulary) plus
 * the position, and sanitize even that.
 */
function describeTomlError(err: unknown): string {
  const reason = sanitize(String((err as Error)?.message ?? err).split("\n")[0] ?? "");
  const { line, column } = err as { line?: unknown; column?: unknown };
  const where =
    typeof line === "number" && typeof column === "number"
      ? ` (line ${line}, column ${column})`
      : "";
  return (reason || "invalid TOML") + where;
}

/** Raw parse of a TOML file into a plain object, with a friendly error. */
function parseTomlFile(path: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new CliError(
      `Cannot read config at ${sanitize(path, 512)}: ${sanitize((err as Error).message)}`,
      "runtime",
    );
  }
  try {
    return parseToml(text) as Record<string, unknown>;
  } catch (err) {
    throw new CliError(
      `Failed to parse config at ${sanitize(path, 512)}: ${describeTomlError(err)}`,
      "runtime",
    );
  }
}

/**
 * Read flat NON-SECRET settings from a TOML file. Used for project
 * `.linear.toml`; the API key is intentionally NOT read here (trust boundary).
 */
function readTomlFile(path: string): RawSettings {
  const parsed = parseTomlFile(path);
  return {
    team: asString(parsed.team ?? parsed.team_id),
    workspace: asString(parsed.workspace),
    sort: asString(parsed.sort ?? parsed.issue_sort),
    vcs: asString(parsed.vcs),
  };
}

/** Read the user config into its structured form (settings + workspaces). */
function readUserConfig(path: string): UserConfig {
  if (!existsSync(path)) return { settings: {}, workspaces: {} };
  const parsed = parseTomlFile(path);
  const workspaces: Record<string, string> = {};
  const wsTable = parsed.workspaces;
  if (wsTable && typeof wsTable === "object") {
    for (const [slug, val] of Object.entries(wsTable as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        const key = asString((val as Record<string, unknown>).api_key);
        if (key) workspaces[slug] = key;
      }
    }
  }
  return {
    settings: {
      team: asString(parsed.team ?? parsed.team_id),
      workspace: asString(parsed.workspace),
      sort: asString(parsed.sort ?? parsed.issue_sort),
      vcs: asString(parsed.vcs),
    },
    defaultWorkspace: asString(parsed.default_workspace),
    workspaces,
  };
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
  const user = readUserConfig(userPath);
  const projectPath = findProjectConfig(cwd);
  const projectSettings = projectPath ? readTomlFile(projectPath) : {};

  // ----- API key resolution (strict trust boundary) -----------------------
  // Resolution is TOTAL: selection problems are stashed in `apiKeyError` rather
  // than thrown, so auth-repair commands can still build a Context. The error
  // is surfaced lazily, when an API client is actually needed.
  let apiKey: string | undefined;
  let apiKeySource: ConfigSource = "none";
  let credentialWorkspace: string | undefined;
  let apiKeyError: CliError | undefined;

  if (flags.apiKey) {
    // 1. An explicit flag is absolute: it bypasses all workspace selection.
    apiKey = flags.apiKey;
    apiKeySource = "flag";
  } else if (envSettings.apiKey) {
    // 1. LINEAR_API_KEY/LINEAR_API_TOKEN is absolute too.
    apiKey = envSettings.apiKey;
    apiKeySource = "env";
  } else {
    // 2. Otherwise compute the credential workspace. Project config is NEVER
    //    consulted here (secrets must not be steerable by project files).
    const selected =
      flags.workspace ?? env.LINEAR_WORKSPACE ?? user.defaultWorkspace;

    if (selected) {
      // 3. A workspace was selected: it must have a stored credential.
      const key = user.workspaces[selected];
      if (!key) {
        apiKeyError = new CliError(
          `No stored credential for workspace '${selected}'. Run \`linear auth list\` to see configured workspaces, or \`linear auth login --workspace ${selected}\`.`,
          "not_found",
        );
      } else {
        apiKey = key;
        apiKeySource = "user";
        credentialWorkspace = selected;
      }
    } else {
      // 4. No selection: use the sole workspace if exactly one is configured.
      const slugs = Object.keys(user.workspaces);
      if (slugs.length === 1) {
        const only = slugs[0]!;
        apiKey = user.workspaces[only];
        apiKeySource = "user";
        credentialWorkspace = only;
      } else if (slugs.length > 1) {
        // Multiple workspaces but no default → ambiguous (deferred).
        apiKeyError = new CliError(
          `Multiple workspaces are configured (${slugs.join(", ")}) but none is selected. Pass --workspace <slug> or run \`linear auth default <slug>\`.`,
          "usage",
        );
      }
      // else: no key at all (unchanged "no API key" path).
    }
  }

  // ----- Non-secret settings (project config MAY participate) -------------
  const pick = <K extends keyof RawSettings>(key: K): string | undefined =>
    flags[key] ?? envSettings[key] ?? projectSettings[key] ?? user.settings[key];

  /** Which tier `pick` would have taken the value from. */
  const sourceOf = <K extends keyof RawSettings>(key: K): ConfigSource => {
    if (flags[key] !== undefined) return "flag";
    if (envSettings[key] !== undefined) return "env";
    if (projectSettings[key] !== undefined) return "project";
    if (user.settings[key] !== undefined) return "user";
    return "none";
  };

  return {
    apiKey,
    apiKeySource,
    apiKeyError,
    credentialWorkspace,
    team: pick("team"),
    // The display `workspace` setting is separate from credential selection:
    // flag > env > project > user. (Credential selection ignores project.)
    workspace: flags.workspace ?? envSettings.workspace ?? projectSettings.workspace ?? user.settings.workspace,
    sort: pick("sort") ?? "priority",
    sortSource: sourceOf("sort"),
    vcs: pick("vcs") ?? "git",
    userConfigPath: userPath,
    projectConfigPath: projectPath,
  };
}

// ---------------------------------------------------------------------------
// Structured TOML writers
//
// We round-trip through a plain object and smol-toml's `stringify` so nested
// `[workspaces."<slug>"]` tables and other settings are preserved. smol-toml
// quotes keys only when required, but hyphenated slugs are valid bare TOML
// keys and round-trip correctly.
// ---------------------------------------------------------------------------

/** Read the full user config as a mutable plain object (or {} if absent). */
function readUserObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  return parseTomlFile(path);
}

/**
 * Serialize + persist a config object ATOMICALLY, with 0600 perms.
 *
 * Writing in place truncates the file first, so a crash — or a concurrent
 * reader, or a second `linear auth login` — could see a half-written config and
 * lose every stored credential. Instead we write a temp file in the same
 * directory (same filesystem, so the rename is atomic), fsync it, and rename it
 * over the target: a reader sees either the old config or the new one, never a
 * torn one. The temp file is created 0600 from the start, so the key is never
 * momentarily readable by anyone else — as before, 0600 is asserted rather than
 * inherited, so a config that was loosened by hand is tightened again.
 */
function writeUserObject(path: string, obj: Record<string, unknown>): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const mode = 0o600;
  const tmp = join(dir, `.${basename(path)}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  const body = stringifyToml(obj) + "\n";
  try {
    // 'wx' refuses to clobber, so two racing writers cannot share a temp file.
    const fd = openSync(tmp, "wx", mode);
    try {
      writeFileSync(fd, body, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // The create mode is masked by umask; restate it before the file is linked
    // into place under its real name.
    chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Nothing to clean up.
    }
    throw err;
  }
}

function workspacesTable(obj: Record<string, unknown>): Record<string, { api_key?: string }> {
  if (!obj.workspaces || typeof obj.workspaces !== "object") obj.workspaces = {};
  return obj.workspaces as Record<string, { api_key?: string }>;
}

/**
 * Upsert `[workspaces."<slug>"].api_key`. If no `default_workspace` is set, this
 * slug becomes the default. All other content is preserved. Returns the path.
 */
export function writeCredential(slug: string, apiKey: string): string {
  const path = userConfigPath();
  const obj = readUserObject(path);
  const ws = workspacesTable(obj);
  ws[slug] = { ...(ws[slug] ?? {}), api_key: apiKey };
  if (!asString(obj.default_workspace)) obj.default_workspace = slug;
  writeUserObject(path, obj);
  return path;
}

/** Set `default_workspace`. Errors if that workspace has no stored credential. */
export function setDefaultWorkspace(slug: string): string {
  const path = userConfigPath();
  const obj = readUserObject(path);
  const ws = workspacesTable(obj);
  if (!ws[slug] || !asString(ws[slug].api_key)) {
    throw new CliError(
      `Workspace '${slug}' is not configured. Run \`linear auth login --workspace ${slug}\` first.`,
      "not_found",
    );
  }
  obj.default_workspace = slug;
  writeUserObject(path, obj);
  return path;
}

/**
 * Remove one `[workspaces."<slug>"]` table without touching anything else. If
 * the removed slug was the default, the default is repointed to a remaining
 * workspace (or cleared). Returns true if something was removed.
 */
export function removeCredential(slug: string): boolean {
  const path = userConfigPath();
  if (!existsSync(path)) return false;
  const obj = readUserObject(path);

  const ws = workspacesTable(obj);
  if (!ws[slug]) return false;
  delete ws[slug];
  if (Object.keys(ws).length === 0) delete obj.workspaces;

  if (asString(obj.default_workspace) === slug) {
    const remaining = obj.workspaces ? Object.keys(obj.workspaces as object) : [];
    if (remaining.length > 0) obj.default_workspace = remaining[0]!;
    else delete obj.default_workspace;
  }
  writeUserObject(path, obj);
  return true;
}

export interface CredentialEntry {
  /** Workspace slug. */
  slug: string;
  isDefault: boolean;
}

/** List configured credentials: one entry per stored workspace. */
export function listCredentials(env: NodeJS.ProcessEnv = process.env): CredentialEntry[] {
  const path = userConfigPath(env);
  const user = readUserConfig(path);
  return Object.keys(user.workspaces).map((slug) => ({
    slug,
    isDefault: user.defaultWorkspace === slug,
  }));
}

/** Redact a secret for display: keep the prefix and last 4 chars. */
export function redactKey(key: string | undefined): string {
  if (!key) return "(not set)";
  if (key.length <= 12) return "••••";
  const prefix = key.startsWith("lin_api_") ? "lin_api_" : key.slice(0, 4);
  return `${prefix}••••${key.slice(-4)}`;
}
