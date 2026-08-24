import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BIN, LIVE, ensureBuilt } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const KEY = process.env.LINEAR_API_KEY ?? "";
const SLUG = "test-workspace-bla";

/**
 * Multi-workspace auth writes to the user config, so these tests run the CLI
 * against an isolated XDG_CONFIG_HOME and strip LINEAR_API_KEY/WORKSPACE from the
 * child env — credential resolution must come from the temp config we manage,
 * never from the ambient env or the developer's real ~/.config/linear.
 */
suite("multi-workspace auth (live, isolated config)", () => {
  let configHome: string;

  function runIn(
    args: string[],
    opts: { keepHome?: boolean } = {},
  ): { code: number; stdout: string; stderr: string } {
    const env = { ...process.env };
    delete env.LINEAR_API_KEY;
    delete env.LINEAR_API_TOKEN;
    delete env.LINEAR_WORKSPACE;
    // Isolate config + home so resolution can ONLY come from our temp config.
    // (`keepHome` is for the keyring tests: /usr/bin/security finds the login
    // keychain through $HOME, so a fake HOME means no keychain — and a GUI
    // authorization prompt that the headless child can only cancel.)
    env.XDG_CONFIG_HOME = configHome;
    if (!opts.keepHome) env.HOME = configHome;
    try {
      // `--no-env-file` stops Bun from auto-loading a stray .env that could
      // re-inject the real key and bypass the temp config we're testing.
      const stdout = execFileSync("bun", ["--no-env-file", BIN, ...args], {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, stdout, stderr: "" };
    } catch (err: any) {
      return {
        code: typeof err.status === "number" ? err.status : 1,
        stdout: err.stdout?.toString() ?? "",
        stderr: err.stderr?.toString() ?? "",
      };
    }
  }
  const jsonIn = <T = any>(args: string[], opts: { keepHome?: boolean } = {}): T => {
    const r = runIn([...args, "--json"], opts);
    if (r.code !== 0) throw new Error(`CLI failed (${r.code}): ${r.stderr || r.stdout}`);
    return JSON.parse(r.stdout) as T;
  };

  // Log in once into the isolated config; the read-only assertions below are then
  // order-independent. Teardown (logout) is the final test. `--plaintext` keeps
  // this suite inside the temp config: without it the key would land in the
  // machine's real keyring under the real workspace slug.
  beforeAll(() => {
    ensureBuilt();
    configHome = mkdtempSync(join(tmpdir(), "lincli-auth-"));
    const out = jsonIn<{ success: boolean; workspace: string; storage: string }>([
      "auth",
      "login",
      "--key",
      KEY,
      "--plaintext",
    ]);
    expect(out.success).toBe(true);
    expect(out.workspace).toBe(SLUG);
    expect(out.storage).toBe("file");
  });
  afterAll(() => rmSync(configHome, { recursive: true, force: true }));

  it("list shows the stored workspace as the default, kept in the file", () => {
    const list = jsonIn<Array<{ slug: string; isDefault: boolean; storage: string }>>([
      "auth",
      "list",
    ]);
    const entry = list.find((e) => e.slug === SLUG);
    expect(entry).toBeDefined();
    expect(entry!.isDefault).toBe(true);
    expect(entry!.storage).toBe("file");
  });

  it("token prints the stored key for the active workspace", () => {
    const tok = jsonIn<{ apiKey: string; workspace: string }>(["auth", "token"]);
    expect(tok.apiKey).toBe(KEY);
    expect(tok.workspace).toBe(SLUG);
  });

  it("status reports authenticated from the user config", () => {
    const st = jsonIn<{ authenticated: boolean; source: string; workspace: string }>([
      "auth",
      "status",
    ]);
    expect(st.authenticated).toBe(true);
    expect(st.source).toBe("user");
    expect(st.workspace).toBe(SLUG);
  });

  it("the stored credential actually authenticates (whoami)", () => {
    const me = jsonIn<{ organization: { urlKey: string } }>(["whoami"]);
    expect(me.organization.urlKey).toBe(SLUG);
  });

  it("default <slug> succeeds for the configured workspace", () => {
    const out = jsonIn<{ success: boolean; default_workspace: string }>(["auth", "default", SLUG]);
    expect(out.success).toBe(true);
    expect(out.default_workspace).toBe(SLUG);
  });

  // Final lifecycle step: logout empties the store, after which token must error.
  it("logout removes the sole credential, then token errors cleanly", () => {
    const out = jsonIn<{ success?: boolean; removed?: boolean }>(["auth", "logout"]);
    expect(out.success ?? out.removed).toBeTruthy();
    expect(jsonIn<Array<unknown>>(["auth", "list"])).toHaveLength(0);

    const res = runIn(["auth", "token", "--json"]);
    expect(res.code).not.toBe(0);
    expect(JSON.parse(res.stderr).error).toBeDefined();
  });

  /**
   * The keyring path, on the real OS keyring but under a throwaway
   * `clitest-` slug: `auth login` stores the secret there by default, the file
   * carries only the marker, `auth status` says so, and `auth logout` takes it
   * back out. macOS only (that is the keyring this machine has); the whole
   * suite is already gated on LIVE.
   */
  describe.skipIf(process.platform !== "darwin")("keyring storage (macOS Keychain)", () => {
    const kcSlug = `clitest-auth-${process.pid}`;

    afterAll(() => {
      // Never leave a test item behind, whatever the assertions did.
      try {
        execFileSync(
          "/usr/bin/security",
          ["delete-generic-password", "-a", kcSlug, "-s", "linear-cli"],
          {
            stdio: "ignore",
          },
        );
      } catch {
        // Already gone — that is the point.
      }
    });

    it("login stores the key in the Keychain and the file keeps only a marker", () => {
      const out = jsonIn<{ storage: string; workspace: string; path: string }>(
        ["auth", "login", "--key", KEY, "--workspace", kcSlug],
        { keepHome: true },
      );
      expect(out.storage).toBe("keychain");
      expect(out.workspace).toBe(kcSlug);
      const file = readFileSync(out.path, "utf8");
      // (hyphenated slugs are valid bare TOML keys, so no quotes here)
      expect(file).toContain(`[workspaces.${kcSlug}]`);
      expect(file).toContain("keyring = true");
      expect(file).not.toContain(KEY);
      // The item is where the reference CLI would look for it.
      const probe = execFileSync(
        "/usr/bin/security",
        ["find-generic-password", "-a", kcSlug, "-s", "linear-cli", "-w"],
        { encoding: "utf8" },
      );
      expect(probe.trim()).toBe(KEY);
    });

    it("status resolves it with Source: keychain and it authenticates", () => {
      const st = jsonIn<{ authenticated: boolean; source: string; workspace: string }>(
        ["auth", "status", "--workspace", kcSlug],
        { keepHome: true },
      );
      expect(st).toMatchObject({ authenticated: true, source: "keychain", workspace: kcSlug });
      const me = jsonIn<{ organization: { urlKey: string } }>(["whoami", "--workspace", kcSlug], {
        keepHome: true,
      });
      expect(me.organization.urlKey).toBe(SLUG);
    });

    it("logout removes the Keychain item", () => {
      const out = jsonIn<{ removed: boolean }>(["auth", "logout", "--workspace", kcSlug], {
        keepHome: true,
      });
      expect(out.removed).toBe(true);
      const res = runIn(["auth", "status", "--workspace", kcSlug, "--json"], { keepHome: true });
      expect(JSON.parse(res.stdout).authenticated).toBe(false);
      const gone = (() => {
        try {
          execFileSync(
            "/usr/bin/security",
            ["find-generic-password", "-a", kcSlug, "-s", "linear-cli"],
            {
              stdio: "ignore",
            },
          );
          return false;
        } catch {
          return true;
        }
      })();
      expect(gone).toBe(true);
    });
  });
});
