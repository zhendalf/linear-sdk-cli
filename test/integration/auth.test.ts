import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

  function runIn(args: string[]): { code: number; stdout: string; stderr: string } {
    const env = { ...process.env };
    delete env.LINEAR_API_KEY;
    delete env.LINEAR_API_TOKEN;
    delete env.LINEAR_WORKSPACE;
    // Isolate config + home so resolution can ONLY come from our temp config.
    env.XDG_CONFIG_HOME = configHome;
    env.HOME = configHome;
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
  const jsonIn = <T = any>(args: string[]): T => {
    const r = runIn([...args, "--json"]);
    if (r.code !== 0) throw new Error(`CLI failed (${r.code}): ${r.stderr || r.stdout}`);
    return JSON.parse(r.stdout) as T;
  };

  // Log in once into the isolated config; the read-only assertions below are then
  // order-independent. Teardown (logout) is the final test.
  beforeAll(() => {
    ensureBuilt();
    configHome = mkdtempSync(join(tmpdir(), "lincli-auth-"));
    const out = jsonIn<{ success: boolean; workspace: string }>(["auth", "login", "--key", KEY]);
    expect(out.success).toBe(true);
    expect(out.workspace).toBe(SLUG);
  });
  afterAll(() => rmSync(configHome, { recursive: true, force: true }));

  it("list shows the stored workspace as the default", () => {
    const list = jsonIn<Array<{ slug: string; isDefault: boolean }>>(["auth", "list"]);
    const entry = list.find((e) => e.slug === SLUG);
    expect(entry).toBeDefined();
    expect(entry!.isDefault).toBe(true);
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
});
