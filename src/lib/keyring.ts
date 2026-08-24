/**
 * OS keyring access for stored API keys.
 *
 * The service name and the account convention are the reference CLI's
 * (schpet/linear-cli 2.x): service `linear-cli`, account = workspace slug. That
 * is deliberate — a user migrating from it already has an entry, and we find it
 * without a re-login. The flip side is that the entry is SHARED: `auth logout`
 * here removes it for both CLIs, and `auth login` here overwrites theirs.
 *
 * Backends are synchronous (spawnSync) because config resolution is
 * synchronous and runs before any command body. Only macOS Keychain and the
 * Linux Secret Service (`secret-tool`) are implemented; everywhere else — and
 * wherever the tool is missing — `keyring()` returns null and the callers fall
 * back to the plaintext file without complaint.
 *
 * The secret never travels on argv (visible to every process via `ps`): on
 * macOS it goes through `security -i`, which reads its command line from stdin;
 * on Linux `secret-tool store` reads the secret from stdin by design.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { CliError } from "./errors.js";

export const KEYRING_SERVICE = "linear-cli";

export type KeyringName = "keychain" | "secret-service";

export interface KeyringBackend {
  /** How the backend is named in receipts and `auth status`. */
  readonly name: KeyringName;
  /** Human label for the store, e.g. "macOS Keychain". */
  readonly label: string;
  /** Read the secret for an account; null when there is no entry. */
  get(account: string): string | null;
  /** Create or replace the entry. */
  set(account: string, secret: string): void;
  /** Remove the entry. Returns false when there was none. */
  delete(account: string): boolean;
}

/** Thrown when the keyring tool ran but failed for a reason other than "no such item". */
export class KeyringError extends CliError {
  constructor(message: string) {
    super(message, "runtime");
    this.name = "KeyringError";
  }
}

// ---------------------------------------------------------------------------
// macOS: /usr/bin/security
// ---------------------------------------------------------------------------

const SECURITY = "/usr/bin/security";
/** `security` exit status for errSecItemNotFound. */
const ERR_SEC_ITEM_NOT_FOUND = 44;

function runSecurity(args: string[], input?: string) {
  const r = spawnSync(SECURITY, args, { encoding: "utf8", input });
  if (r.error) {
    throw new KeyringError(`Could not run ${SECURITY}: ${r.error.message}`);
  }
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: (r.stderr ?? "").trim() };
}

/**
 * Quote one token for `security -i`, whose line parser understands double
 * quotes with backslash escapes (verified: `-a "x\"y"` stores account `x"y`).
 * A newline would end the command mid-way, so it is refused outright rather
 * than escaped — no workspace slug or Linear key contains one anyway.
 */
function quoteForSecurity(token: string, what: string): string {
  if (/[\r\n]/.test(token)) {
    throw new KeyringError(
      `The ${what} contains a line break and cannot be stored in the keychain.`,
    );
  }
  return `"${token.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

export const macosKeychain: KeyringBackend = {
  name: "keychain",
  label: "macOS Keychain",

  get(account) {
    const r = runSecurity(["find-generic-password", "-a", account, "-s", KEYRING_SERVICE, "-w"]);
    if (r.status === 0) {
      // `-w` prints the secret and a trailing newline.
      const secret = r.stdout.replace(/\r?\n$/, "");
      return secret.length > 0 ? secret : null;
    }
    if (r.status === ERR_SEC_ITEM_NOT_FOUND) return null;
    throw new KeyringError(
      `security find-generic-password failed (exit ${r.status})${r.stderr ? `: ${r.stderr}` : ""}`,
    );
  },

  set(account, secret) {
    // Interactive mode reads the whole command from stdin, so the secret is
    // never an argv element. (`add-generic-password -w` as the LAST option
    // prompts instead — but on /dev/tty, so it hangs in a real terminal.)
    const line =
      [
        "add-generic-password",
        "-a",
        quoteForSecurity(account, "workspace slug"),
        "-s",
        KEYRING_SERVICE,
        "-U",
        "-w",
        quoteForSecurity(secret, "API key"),
      ].join(" ") + "\n";
    const r = runSecurity(["-i"], line);
    if (r.status !== 0) {
      throw new KeyringError(
        `security add-generic-password failed (exit ${r.status})${r.stderr ? `: ${r.stderr}` : ""}`,
      );
    }
  },

  delete(account) {
    const r = runSecurity(["delete-generic-password", "-a", account, "-s", KEYRING_SERVICE]);
    if (r.status === 0) return true;
    if (r.status === ERR_SEC_ITEM_NOT_FOUND) return false;
    throw new KeyringError(
      `security delete-generic-password failed (exit ${r.status})${r.stderr ? `: ${r.stderr}` : ""}`,
    );
  },
};

// ---------------------------------------------------------------------------
// Linux: secret-tool (libsecret) — the reference CLI's backend, same attributes
// ---------------------------------------------------------------------------

function runSecretTool(args: string[], input?: string) {
  const r = spawnSync("secret-tool", args, { encoding: "utf8", input });
  if (r.error) {
    throw new KeyringError(
      `Could not run secret-tool (install libsecret, e.g. \`apt install libsecret-tools\`): ${r.error.message}`,
    );
  }
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: (r.stderr ?? "").trim() };
}

export const linuxSecretService: KeyringBackend = {
  name: "secret-service",
  label: "system keyring (Secret Service)",

  get(account) {
    const r = runSecretTool(["lookup", "service", KEYRING_SERVICE, "account", account]);
    if (r.status === 0) {
      // secret-tool writes the secret verbatim (no newline) when piped.
      return r.stdout.length > 0 ? r.stdout : null;
    }
    // Exit 1 with a silent stderr is "no match"; anything on stderr is a failure.
    if (r.status === 1 && r.stderr === "") return null;
    throw new KeyringError(
      `secret-tool lookup failed (exit ${r.status})${r.stderr ? `: ${r.stderr}` : ""}`,
    );
  },

  set(account, secret) {
    const r = runSecretTool(
      [
        "store",
        "--label",
        `${KEYRING_SERVICE}: ${account}`,
        "service",
        KEYRING_SERVICE,
        "account",
        account,
      ],
      secret,
    );
    if (r.status !== 0) {
      throw new KeyringError(
        `secret-tool store failed (exit ${r.status})${r.stderr ? `: ${r.stderr}` : ""}`,
      );
    }
  },

  delete(account) {
    // `clear` succeeds whether or not an item matched, so probe first to
    // report the truth.
    const existed = this.get(account) !== null;
    const r = runSecretTool(["clear", "service", KEYRING_SERVICE, "account", account]);
    if (r.status !== 0) {
      throw new KeyringError(
        `secret-tool clear failed (exit ${r.status})${r.stderr ? `: ${r.stderr}` : ""}`,
      );
    }
    return existed;
  },
};

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Explicit test/application override; `undefined` means automatic detection. */
let overrideBackend: KeyringBackend | null | undefined;
/** Automatic detection is cached only while HOME is unchanged. */
let detectedBackend: KeyringBackend | null | undefined;
let detectedHome: string | undefined;

function detect(): KeyringBackend | null {
  if (process.platform === "darwin") {
    if (!existsSync(SECURITY)) return null;
    // `security add-generic-password` opens a system dialog when the process
    // has no default user keychain (common with an isolated HOME in tests,
    // containers, and launch agents). Probe first so that environment is
    // treated like every other machine without a usable keyring and callers
    // can fall back to the 0600 credential file without surprising UI.
    const probe = spawnSync(SECURITY, ["default-keychain", "-d", "user"], {
      encoding: "utf8",
    });
    return !probe.error && probe.status === 0 ? macosKeychain : null;
  }
  if (process.platform === "linux") {
    // With no arguments secret-tool prints usage and exits 2; a completed run
    // (any status) proves the executable is on PATH.
    const r = spawnSync("secret-tool", [], { encoding: "utf8" });
    return r.error ? null : linuxSecretService;
  }
  return null;
}

/**
 * The keyring for this machine, or null when there is none — in which case
 * callers keep the plaintext file and say nothing, because that is not an
 * error condition, just a platform.
 */
export function keyring(): KeyringBackend | null {
  if (overrideBackend !== undefined) return overrideBackend;
  const home = process.env.HOME;
  if (detectedBackend === undefined || detectedHome !== home) {
    detectedBackend = detect();
    detectedHome = home;
  }
  return detectedBackend;
}

/**
 * Test seam: install a fake backend (or `null` for "no keyring") so unit tests
 * never touch the developer's real Keychain. `undefined` restores detection.
 */
export function setKeyringBackend(backend: KeyringBackend | null | undefined): void {
  overrideBackend = backend;
  if (backend === undefined) {
    // Tests routinely swap HOME to an isolated fixture. Do not let a backend
    // detected against the real login keychain escape into that environment.
    detectedBackend = undefined;
    detectedHome = undefined;
  }
}

/** An in-memory backend for tests. */
export function memoryKeyring(initial: Record<string, string> = {}): KeyringBackend & {
  readonly store: Map<string, string>;
} {
  const store = new Map(Object.entries(initial));
  return {
    name: "keychain",
    label: "test keyring",
    store,
    get: (a) => store.get(a) ?? null,
    set: (a, s) => void store.set(a, s),
    delete: (a) => store.delete(a),
  };
}
