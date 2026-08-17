/**
 * Configuration resolution.
 *
 * Two tiers with different trust boundaries:
 *  - Non-secret settings (team, workspace, sort, vcs): flag > env > project
 *    config > user config (`~/.config/linear/config.toml`) > the reference
 *    CLI's global config (`~/.config/linear/linear.toml`, read-only).
 *    The project config is the first file found walking cwd → filesystem
 *    root, checking `linear.toml`, `.linear.toml`, `.config/linear.toml` in
 *    each directory — every location schpet/linear-cli 2.5 reads (it checks
 *    cwd and the git root; we check every directory between, which is a
 *    superset), in its order.
 *  - The API key has a STRICTER boundary and is never read from a project file
 *    or from the reference CLI's global file (avoids committing secrets):
 *    flag > LINEAR_API_KEY env > user config (plaintext `api_key`) > OS keyring.
 *
 * Multi-workspace credentials live under quoted `[workspaces."<slug>"]` tables
 * in the user config, with an optional top-level `default_workspace`. A table
 * either carries the key itself (`api_key = "…"`, plaintext, 0600 file) or
 * marks the slug as keyring-backed (`keyring = true`), in which case the secret
 * lives in the OS keyring under service `linear-cli` / account `<slug>` — the
 * reference CLI's convention, so a user migrating from it is authenticated
 * before they run a single command. Its own workspace list
 * (`credentials.toml`, a sibling of our file) is read for slugs and the
 * default, never for keys. Credential selection is lazy: resolution never
 * throws, stashing any selection error in `apiKeyError` so it surfaces only
 * when a client is actually needed.
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
import { execFileSync } from "node:child_process";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { CliError } from "./lib/errors.js";
import { keyring, KeyringError } from "./lib/keyring.js";

export interface RawSettings {
  team?: string;
  workspace?: string;
  sort?: string;
  vcs?: string;
  apiKey?: string;
}

/**
 * Where a value came from. `user` is our `~/.config/linear/config.toml`;
 * `global` is the reference CLI's `~/.config/linear/linear.toml`, read for
 * non-secret settings only; `keychain` is the OS keyring (API key only).
 */
export type ConfigSource = "flag" | "env" | "project" | "user" | "global" | "keychain" | "none";

/** Where a stored workspace credential's secret lives. */
export type CredentialStorage = "file" | "keychain";

/** A setting's provenance: which tier, and (for a file) which file. */
export interface SettingOrigin {
  source: ConfigSource;
  path?: string;
}

/** The non-secret settings, each with its provenance. */
export type SettingOrigins = Record<"team" | "workspace" | "sort" | "vcs", SettingOrigin>;

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
  /** Provenance of every non-secret setting (`linear config` shows it). */
  origins: SettingOrigins;
  /** Absolute path of the user config file (may not exist yet). */
  userConfigPath: string;
  /** Project config path that was loaded, if any (see `findProjectConfig`). */
  projectConfigPath?: string;
  /** The reference CLI's global `linear.toml`, when it exists and was read. */
  globalConfigPath?: string;
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

/**
 * The reference CLI's global config (`$XDG_CONFIG_HOME/linear/linear.toml`),
 * a sibling of ours. Read for non-secret settings, below our own file; its
 * `api_key`, if any, is ignored like a project file's.
 */
export function globalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(dirname(userConfigPath(env)), "linear.toml");
}

/**
 * The project config file names, in the order they are tried in each
 * directory — the reference CLI's order, so a repo that has more than one
 * resolves the same way under both tools.
 */
export const PROJECT_CONFIG_NAMES = ["linear.toml", ".linear.toml", join(".config", "linear.toml")] as const;

/**
 * The reference CLI's credentials file, a sibling of our config. Its keyring
 * format is `default = "slug"` + `workspaces = ["slug", …]` with the secrets in
 * the OS keyring; its inline (plaintext) format is `slug = "lin_api_…"`, which
 * we deliberately do NOT read — our secret sources are the flag, the env, our
 * own 0600 file and the keyring, full stop.
 */
export function referenceCredentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(dirname(userConfigPath(env)), "credentials.toml");
}

/** One stored workspace, as the user config knows it. */
interface WorkspaceEntry {
  /** Plaintext key from `[workspaces."<slug>"].api_key`; absent → keyring-backed. */
  apiKey?: string;
}

/** Parsed view of the user config: top-level settings + nested workspace creds. */
interface UserConfig {
  /** Top-level non-secret settings. */
  settings: RawSettings;
  /** default_workspace, if set (ours, else the reference CLI's `default`). */
  defaultWorkspace?: string;
  /** slug → entry from `[workspaces."<slug>"]`, plus the reference CLI's list. */
  workspaces: Record<string, WorkspaceEntry>;
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

/**
 * The workspace slugs (and default) the reference CLI's `credentials.toml`
 * lists, when it is in keyring format. Its inline format is ignored entirely:
 * listing those slugs without reading their keys would only produce a
 * "no stored credential" error for a workspace the user can see in the file.
 */
function readReferenceCredentials(path: string): { workspaces: string[]; defaultWorkspace?: string } {
  if (!existsSync(path)) return { workspaces: [] };
  const parsed = parseTomlFile(path);
  const list = parsed.workspaces;
  if (!Array.isArray(list)) return { workspaces: [] };
  const workspaces = [...new Set(list.filter((v): v is string => typeof v === "string" && v.length > 0))];
  const def = asString(parsed.default);
  return {
    workspaces,
    // The reference CLI itself ignores a default that is not in the list.
    defaultWorkspace: def && workspaces.includes(def) ? def : undefined,
  };
}

/** Read the user config into its structured form (settings + workspaces). */
function readUserConfig(path: string): UserConfig {
  const workspaces: Record<string, WorkspaceEntry> = {};
  const parsed = existsSync(path) ? parseTomlFile(path) : {};
  const wsTable = parsed.workspaces;
  if (wsTable && typeof wsTable === "object") {
    for (const [slug, val] of Object.entries(wsTable as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        // A table with no api_key is a keyring-backed workspace (whether or
        // not it carries the `keyring = true` marker `auth login` writes).
        workspaces[slug] = { apiKey: asString((val as Record<string, unknown>).api_key) };
      }
    }
  }
  // Then the reference CLI's list, so its keyring entries are found without a
  // re-login. Ours wins on a shared slug (a plaintext key here beats the keyring).
  const reference = readReferenceCredentials(join(dirname(path), "credentials.toml"));
  for (const slug of reference.workspaces) workspaces[slug] ??= {};
  return {
    settings: {
      team: asString(parsed.team ?? parsed.team_id),
      workspace: asString(parsed.workspace),
      sort: asString(parsed.sort ?? parsed.issue_sort),
      vcs: asString(parsed.vcs),
    },
    defaultWorkspace: asString(parsed.default_workspace) ?? reference.defaultWorkspace,
    workspaces,
  };
}

/**
 * The secret for a workspace: the plaintext key from our file if there is
 * one, else the keyring entry. Returns the source alongside so `auth status`
 * can say which. A keyring failure that is not "no such item" is reported as
 * an error rather than mistaken for a missing credential.
 */
function lookupCredential(
  user: UserConfig,
  slug: string,
): { apiKey: string; source: "user" | "keychain" } | { error: CliError } | undefined {
  const plaintext = user.workspaces[slug]?.apiKey;
  if (plaintext) return { apiKey: plaintext, source: "user" };
  const backend = keyring();
  if (!backend) return undefined;
  try {
    const secret = backend.get(slug);
    return secret ? { apiKey: secret, source: "keychain" } : undefined;
  } catch (err) {
    if (err instanceof KeyringError) {
      return {
        error: new CliError(
          `Could not read the ${backend.label} entry for workspace '${slug}': ${err.message}`,
          "runtime",
        ),
      };
    }
    throw err;
  }
}

/**
 * Walk from cwd up to the filesystem root and return the first project config:
 * in each directory `linear.toml`, then `.linear.toml`, then
 * `.config/linear.toml`. That is every file the reference CLI reads (it looks
 * in cwd and at the git root; every directory in between is a superset that
 * agrees with it wherever it would find something) — so a repo set up with its
 * `linear config`, which prefers `<gitroot>/.config/linear.toml`, just works.
 */
export function findProjectConfig(cwd: string): string | undefined {
  let dir = cwd;
  const { root } = parsePath(dir);
  // Bound the walk so a pathological symlink loop can't spin forever.
  for (let i = 0; i < 64; i++) {
    for (const name of PROJECT_CONFIG_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
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
  // The reference CLI's global file: same non-secret reader as a project file,
  // so its `api_key` (it does allow one there) is never picked up.
  const globalCandidate = globalConfigPath(env);
  const globalPath = existsSync(globalCandidate) ? globalCandidate : undefined;
  const globalSettings = globalPath ? readTomlFile(globalPath) : {};

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

    // Apply a lookup result for the slug the selection settled on. An
    // explicitly named slug is probed even when no file lists it — the keyring
    // entry may be all the user has (the reference CLI's, say, with its list
    // file gone) — but a listed slug with nothing behind it is a stale entry.
    const take = (slug: string) => {
      const found = lookupCredential(user, slug);
      if (!found) {
        apiKeyError = new CliError(
          `No stored credential for workspace '${slug}'. Run \`linear auth list\` to see configured workspaces, or \`linear auth login --workspace ${slug}\`.`,
          "not_found",
        );
      } else if ("error" in found) {
        apiKeyError = found.error;
      } else {
        apiKey = found.apiKey;
        apiKeySource = found.source;
        credentialWorkspace = slug;
      }
    };

    if (selected) {
      // 3. A workspace was selected: it must have a stored credential.
      take(selected);
    } else {
      // 4. No selection: use the sole workspace if exactly one is configured.
      const slugs = Object.keys(user.workspaces);
      if (slugs.length === 1) {
        take(slugs[0]!);
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

  // ----- Non-secret settings (project + global config MAY participate) -----
  // flag > env > project file > our user file > the reference CLI's global file.
  const tiers: Array<[ConfigSource, RawSettings, string | undefined]> = [
    ["flag", flags, undefined],
    ["env", envSettings, undefined],
    ["project", projectSettings, projectPath],
    ["user", user.settings, userPath],
    ["global", globalSettings, globalPath],
  ];
  const pick = <K extends "team" | "workspace" | "sort" | "vcs">(key: K): string | undefined =>
    tiers.find(([, settings]) => settings[key] !== undefined)?.[1][key];

  /** Which tier `pick` took the value from, and which file if it was one. */
  const originOf = (key: "team" | "workspace" | "sort" | "vcs"): SettingOrigin => {
    const hit = tiers.find(([, settings]) => settings[key] !== undefined);
    return hit ? { source: hit[0], path: hit[2] } : { source: "none" };
  };

  const origins: SettingOrigins = {
    team: originOf("team"),
    workspace: originOf("workspace"),
    sort: originOf("sort"),
    vcs: originOf("vcs"),
  };

  return {
    apiKey,
    apiKeySource,
    apiKeyError,
    credentialWorkspace,
    team: pick("team"),
    // The display `workspace` setting is separate from credential selection:
    // it walks every tier. (Credential selection ignores project + global.)
    workspace: pick("workspace"),
    sort: pick("sort") ?? "priority",
    sortSource: origins.sort.source,
    vcs: pick("vcs") ?? "git",
    origins,
    userConfigPath: userPath,
    projectConfigPath: projectPath,
    globalConfigPath: globalPath,
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
 * Persist text ATOMICALLY, with the given perms.
 *
 * Writing in place truncates the file first, so a crash — or a concurrent
 * reader, or a second `linear auth login` — could see a half-written config and
 * lose every stored credential. Instead we write a temp file in the same
 * directory (same filesystem, so the rename is atomic), fsync it, and rename it
 * over the target: a reader sees either the old config or the new one, never a
 * torn one. The temp file is created with `mode` from the start, so a 0600 key
 * file is never momentarily readable by anyone else — and the mode is asserted
 * rather than inherited, so a config that was loosened by hand is tightened
 * again.
 */
function writeFileAtomic(path: string, body: string, mode: number): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const tmp = join(dir, `.${basename(path)}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
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

/** Serialize + persist the user config object atomically, 0600 (it holds keys). */
function writeUserObject(path: string, obj: Record<string, unknown>): void {
  writeFileAtomic(path, stringifyToml(obj) + "\n", 0o600);
}

interface WorkspaceTable {
  api_key?: string;
  keyring?: boolean;
}

function workspacesTable(obj: Record<string, unknown>): Record<string, WorkspaceTable> {
  if (!obj.workspaces || typeof obj.workspaces !== "object") obj.workspaces = {};
  return obj.workspaces as Record<string, WorkspaceTable>;
}

export interface WriteCredentialResult {
  /** Our config file — always written (the slug list lives there). */
  path: string;
  /** Where the secret itself went. */
  storage: CredentialStorage;
  /** Human label of the keyring used, when `storage` is "keychain". */
  keyringLabel?: string;
}

/**
 * Store a credential for `slug`. By default the secret goes to the OS keyring
 * (service `linear-cli`, account = slug) and the file only records
 * `[workspaces."<slug>"] keyring = true`; with `plaintext`, or where there is
 * no keyring, it is written as `api_key` in the 0600 file — the latter without
 * complaint, since a platform is not an error. Either way the OTHER form for
 * the same slug is dropped from the file, so a re-login moves the key rather
 * than leaving a plaintext copy behind that would keep winning. If no default
 * workspace exists anywhere (ours or the reference CLI's), this slug becomes it.
 */
export function writeCredential(
  slug: string,
  apiKey: string,
  opts: { plaintext?: boolean } = {},
): WriteCredentialResult {
  const path = userConfigPath();
  const backend = opts.plaintext ? null : keyring();
  const obj = readUserObject(path);
  const ws = workspacesTable(obj);
  const table: WorkspaceTable = { ...(ws[slug] ?? {}) };
  let storage: CredentialStorage;
  if (backend) {
    // Keyring first: if it refuses, the file is untouched and the error is loud.
    backend.set(slug, apiKey);
    delete table.api_key;
    table.keyring = true;
    storage = "keychain";
  } else {
    delete table.keyring;
    table.api_key = apiKey;
    storage = "file";
  }
  ws[slug] = table;
  if (!asString(obj.default_workspace)) {
    // Leave the reference CLI's default in charge if it has one; writing ours
    // over it would silently switch a migrating user's workspace.
    const reference = readReferenceCredentials(referenceCredentialsPath());
    if (!reference.defaultWorkspace) obj.default_workspace = slug;
  }
  writeUserObject(path, obj);
  return { path, storage, keyringLabel: backend?.label };
}

/** Set `default_workspace`. Errors if that workspace is not configured anywhere. */
export function setDefaultWorkspace(slug: string): string {
  const path = userConfigPath();
  const known = readUserConfig(path).workspaces;
  if (!known[slug]) {
    throw new CliError(
      `Workspace '${slug}' is not configured. Run \`linear auth login --workspace ${slug}\` first.`,
      "not_found",
    );
  }
  const obj = readUserObject(path);
  obj.default_workspace = slug;
  writeUserObject(path, obj);
  return path;
}

/**
 * Drop `slug` from the reference CLI's keyring-format credentials list, if it
 * is there, in that file's own layout (`default` first, sorted `workspaces`).
 * Left alone, the entry would make BOTH CLIs report a workspace whose keyring
 * secret is gone. Returns true if the file changed.
 */
function removeFromReferenceCredentials(slug: string): boolean {
  const path = referenceCredentialsPath();
  const reference = readReferenceCredentials(path);
  if (!reference.workspaces.includes(slug)) return false;
  const workspaces = reference.workspaces.filter((s) => s !== slug).sort();
  const def = reference.defaultWorkspace === slug ? workspaces[0] : reference.defaultWorkspace;
  const obj: Record<string, unknown> = {};
  if (def) obj.default = def;
  obj.workspaces = workspaces;
  writeUserObject(path, obj);
  return true;
}

/**
 * Forget a workspace: remove its `[workspaces."<slug>"]` table, its keyring
 * entry, and its line in the reference CLI's list — whichever exist. If the
 * removed slug was the default, the default is repointed to a remaining
 * workspace (or cleared). Returns true if anything was removed.
 */
export function removeCredential(slug: string): boolean {
  const path = userConfigPath();
  let removed = false;

  const backend = keyring();
  if (backend && backend.delete(slug)) removed = true;
  if (removeFromReferenceCredentials(slug)) removed = true;

  if (!existsSync(path)) return removed;
  const obj = readUserObject(path);
  const ws = workspacesTable(obj);
  const listed = Boolean(ws[slug]);
  if (listed) {
    delete ws[slug];
    removed = true;
  }
  if (Object.keys(ws).length === 0) delete obj.workspaces;

  if (asString(obj.default_workspace) === slug) {
    const remaining = obj.workspaces ? Object.keys(obj.workspaces as object) : [];
    if (remaining.length > 0) obj.default_workspace = remaining[0]!;
    else delete obj.default_workspace;
    writeUserObject(path, obj);
  } else if (listed) {
    writeUserObject(path, obj);
  }
  return removed;
}

export interface MigrateResult {
  /** Slugs whose keys moved from the file into the keyring. */
  migrated: string[];
  path: string;
  keyringLabel: string;
}

/**
 * Move every plaintext `api_key` in the user config into the OS keyring,
 * leaving `keyring = true` markers behind. All-or-nothing: if one store fails,
 * the entries already written are deleted again and the file is not touched.
 */
export function migrateCredentials(): MigrateResult {
  const backend = keyring();
  const path = userConfigPath();
  if (!backend) {
    throw new CliError(
      `No system keyring is available on this platform; credentials stay in ${path}.`,
      "runtime",
    );
  }
  const obj = readUserObject(path);
  const ws = workspacesTable(obj);
  const plaintext = Object.entries(ws).filter(([, t]) => asString(t.api_key));
  const migrated: string[] = [];
  try {
    for (const [slug, table] of plaintext) {
      backend.set(slug, table.api_key!);
      migrated.push(slug);
    }
  } catch (err) {
    for (const slug of migrated) {
      try {
        backend.delete(slug);
      } catch {
        // Best-effort rollback.
      }
    }
    throw new CliError(
      `Failed to store the key for workspace '${plaintext[migrated.length]![0]}' in the ${backend.label}: ${(err as Error).message}. Rolled back ${migrated.length} already-written entr${migrated.length === 1 ? "y" : "ies"}; ${path} is unchanged.`,
      "runtime",
    );
  }
  if (migrated.length > 0) {
    for (const [, table] of plaintext) {
      delete table.api_key;
      table.keyring = true;
    }
    writeUserObject(path, obj);
  }
  return { migrated, path, keyringLabel: backend.label };
}

export interface CredentialEntry {
  /** Workspace slug. */
  slug: string;
  isDefault: boolean;
  /** Where the secret is kept. */
  storage: CredentialStorage;
}

/** List configured credentials: one entry per stored workspace. */
export function listCredentials(env: NodeJS.ProcessEnv = process.env): CredentialEntry[] {
  const path = userConfigPath(env);
  const user = readUserConfig(path);
  return Object.entries(user.workspaces).map(([slug, entry]) => ({
    slug,
    isDefault: user.defaultWorkspace === slug,
    storage: entry.apiKey ? "file" : "keychain",
  }));
}

/** Redact a secret for display: keep the prefix and last 4 chars. */
export function redactKey(key: string | undefined): string {
  if (!key) return "(not set)";
  if (key.length <= 12) return "••••";
  const prefix = key.startsWith("lin_api_") ? "lin_api_" : key.slice(0, 4);
  return `${prefix}••••${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Project config writers (`config init` / `config set`)
//
// A project file is the user's, hand-edited and committed, so `config set`
// edits it textually — one line replaced or appended — and keeps their
// comments and layout. The result is parsed back to prove the edit did what it
// meant to; only if that check fails does it fall back to a full re-serialize.
// ---------------------------------------------------------------------------

/** The settings `config set` / `config init` will write to a project file. */
export const SETTABLE_KEYS = ["team", "workspace", "sort", "vcs"] as const;
export type SettableKey = (typeof SETTABLE_KEYS)[number];

/**
 * The reference CLI's spelling for each key. A file that already uses it keeps
 * it: `config set team ENG` on a schpet-written `team_id = "TES"` line changes
 * that line rather than adding a second, competing key.
 */
const KEY_ALIASES: Record<SettableKey, readonly string[]> = {
  team: ["team", "team_id"],
  workspace: ["workspace"],
  sort: ["sort", "issue_sort"],
  vcs: ["vcs"],
};

/** Keys that must never be written to a project file, and why. */
const SECRET_KEYS = new Set(["api_key", "workspaces", "default_workspace", "keyring"]);

/**
 * Where `config init` writes and `config set` falls back to when no project
 * config exists yet: `<git root>/.linear.toml` inside a repository (the whole
 * repo then sees it, since discovery walks up), else `<cwd>/.linear.toml`.
 */
export function defaultProjectConfigPath(cwd: string = process.cwd()): string {
  let root: string | undefined;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    // Not a repository.
  }
  return join(root || cwd, ".linear.toml");
}

/** Refuse a key that would put a secret (or the credential store) in a project file. */
export function assertSettableKey(key: string): asserts key is SettableKey {
  if (SECRET_KEYS.has(key)) {
    throw new CliError(
      `'${key}' is not a project setting: secrets and the credential store live only in the user config. Run \`linear auth login\` instead.`,
      "usage",
    );
  }
  if (!(SETTABLE_KEYS as readonly string[]).includes(key)) {
    throw new CliError(
      `Unknown setting '${key}'. Settable keys: ${SETTABLE_KEYS.join(", ")}.`,
      "usage",
    );
  }
}

/** A TOML basic string: JSON's escapes are a subset of TOML's, so this is exact. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Set one top-level key in a TOML file, creating the file if needed.
 * Returns the spelling that was written (`team` or `team_id`, say).
 */
export function setConfigKey(
  path: string,
  key: SettableKey,
  value: string,
  opts: { mode?: number } = {},
): string {
  const mode = opts.mode ?? 0o644;
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  // Parse first so a broken file is reported as such rather than edited blind.
  if (text.trim()) parseTomlFile(path);

  const lines = text.split("\n");
  // Only the top-level region (before the first table header) is ours to
  // touch: `api_key = …` inside `[workspaces.x]` must not be mistaken for a
  // top-level key of the same name.
  const firstTable = lines.findIndex((l) => /^\s*\[/.test(l));
  const topEnd = firstTable === -1 ? lines.length : firstTable;
  const spellings = KEY_ALIASES[key];
  const keyLine = new RegExp(`^\\s*(${spellings.map((s) => s.replace(".", "\\.")).join("|")})\\s*=`);
  const idx = lines.findIndex((l, i) => i < topEnd && keyLine.test(l));

  let spelling: string;
  let next: string[];
  if (idx !== -1) {
    spelling = lines[idx]!.match(keyLine)![1]!;
    // Keep a trailing comment on the line, if any.
    const comment = lines[idx]!.match(/\s+#.*$/)?.[0] ?? "";
    next = [...lines];
    next[idx] = `${spelling} = ${tomlString(value)}${comment}`;
  } else {
    spelling = key;
    next = [...lines];
    // Drop the trailing empty line a `\n`-terminated file splits into (the
    // file is re-terminated below), then insert right after the last
    // non-blank top-level line — before any blank line that separates the
    // top-level keys from the first table. No alias line exists up there (we
    // searched), so the insert is unambiguous.
    if (next[next.length - 1] === "") next.pop();
    let at = firstTable === -1 ? next.length : firstTable;
    while (at > 0 && next[at - 1]!.trim() === "") at--;
    const inserted = [`${spelling} = ${tomlString(value)}`];
    // A file that opens with a table needs a blank line between us and it.
    if (at < next.length && /^\s*\[/.test(next[at]!)) inserted.push("");
    next.splice(at, 0, ...inserted);
  }
  let body = next.join("\n");
  if (!body.endsWith("\n")) body += "\n";

  // Prove the edit: the parsed file must carry exactly this value under this
  // spelling. If a layout we did not foresee defeats the line edit, fall back
  // to a full round-trip — correct, if less pretty.
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = parseToml(body) as Record<string, unknown>;
  } catch {
    parsed = undefined;
  }
  if (!parsed || parsed[spelling] !== value) {
    const obj = text.trim() ? parseTomlFile(path) : {};
    for (const s of spellings) if (s !== spelling) delete obj[s];
    obj[spelling] = value;
    body = stringifyToml(obj) + "\n";
  }
  writeFileAtomic(path, body, mode);
  return spelling;
}

/**
 * Write a fresh project config. Refuses to replace an existing file unless
 * `force`, since `config set` is the tool for changing one value.
 */
export function initProjectConfig(
  path: string,
  settings: Partial<Record<SettableKey, string>>,
  opts: { force?: boolean } = {},
): void {
  if (existsSync(path) && !opts.force) {
    throw new CliError(
      `${path} already exists. Use \`linear config set <key> <value>\` to change a value, or --force to overwrite it.`,
      "usage",
    );
  }
  const lines = [
    "# linear-sdk-cli project config — non-secret defaults for this repository.",
    "# The API key never goes here; `linear auth login` stores it for you.",
  ];
  for (const key of SETTABLE_KEYS) {
    const value = settings[key];
    if (value !== undefined) lines.push(`${key} = ${tomlString(value)}`);
  }
  writeFileAtomic(path, lines.join("\n") + "\n", 0o644);
}
