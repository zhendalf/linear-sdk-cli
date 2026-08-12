import { describe, it, expect, vi, afterEach, beforeEach } from "bun:test";
import { CommanderError } from "commander";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../../src/cli.js";
import { userConfigPath } from "../../src/config.js";

// Commander writes help/version to stdout; silence it during these tests.
afterEach(() => vi.restoreAllMocks());
function silenceStdout() {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
}

describe("commander error boundary", () => {
  it("throws CommanderError on an unknown option (not process.exit)", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(["node", "linear", "whoami", "--definitely-not-a-flag"]),
    ).rejects.toBeInstanceOf(CommanderError);
  });

  it("throws CommanderError on a missing required argument", async () => {
    const program = createProgram();
    await expect(program.parseAsync(["node", "linear", "completion"])).rejects.toBeInstanceOf(
      CommanderError,
    );
  });

  it("treats --version as a zero-exit CommanderError", async () => {
    silenceStdout();
    const program = createProgram();
    try {
      await program.parseAsync(["node", "linear", "--version"]);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CommanderError);
      expect((err as CommanderError).exitCode).toBe(0);
    }
  });

  it("exposes global --json on a leaf command", () => {
    const program = createProgram();
    const help = program.commands.find((c) => c.name() === "config")?.helpInformation() ?? "";
    expect(help).toContain("--json");
  });
});

describe("discovery commands", () => {
  function captureStdout(): { restore: () => void; text: () => string } {
    let out = "";
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
      out += c;
      return true;
    });
    return { restore: () => spy.mockRestore(), text: () => out };
  }

  it("registers `commands` and `schema` as top-level commands", () => {
    const names = createProgram()
      .commands.map((c) => c.name())
      .sort();
    expect(names).toContain("commands");
    expect(names).toContain("schema");
  });

  it("`commands --json` emits a bare array of command nodes (no API call)", async () => {
    const cap = captureStdout();
    try {
      await createProgram().parseAsync(["node", "linear", "commands", "--json"]);
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.text());
    expect(Array.isArray(parsed)).toBe(true);
    const paths = parsed.map((n: any) => n.path);
    expect(paths).toContain("issue create");
    expect(paths).toContain("schema");
    // Every node has the documented shape.
    for (const n of parsed) {
      expect(typeof n.path).toBe("string");
      expect(Array.isArray(n.aliases)).toBe(true);
      expect(Array.isArray(n.arguments)).toBe(true);
      expect(Array.isArray(n.options)).toBe(true);
    }
  });

  // `issue mine` is additive: `list` keeps listing everything, `mine` is the
  // reference CLI's opinionated default view.
  it("registers `issue mine` alongside `issue list`, fixed to the viewer", () => {
    const issue = createProgram().commands.find((c) => c.name() === "issue");
    const mine = issue?.commands.find((c) => c.name() === "mine");
    expect(mine).toBeDefined();
    // No `l` alias (the reference's): `list` is `ls` here, so `l`/`ls` would be
    // one keystroke apart with opposite result sets.
    expect(mine?.aliases()).not.toContain("l");
    expect(issue?.commands.find((c) => c.name() === "list")?.aliases()).toContain("ls");

    const flags = mine!.options.map((o) => o.long);
    expect(flags).toContain("--all-states");
    // No --assignee: overriding it would make the command a lie.
    expect(flags).not.toContain("--assignee");
    // `issue list` still takes one.
    const list = issue?.commands.find((c) => c.name() === "list");
    expect(list!.options.map((o) => o.long)).toContain("--assignee");
  });

  it("`schema --help` registers with -o/--output", () => {
    const schema = createProgram().commands.find((c) => c.name() === "schema");
    const help = schema?.helpInformation() ?? "";
    expect(help).toContain("--output");
    expect(help).toContain("SDL");
  });
});

describe("auth commands operate in the ambiguous (multi-workspace, no default) state", () => {
  let root: string;
  let savedXdg: string | undefined;
  let savedHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lincli-"));
    mkdirSync(join(root, "xdg", "linear"), { recursive: true });
    savedXdg = process.env.XDG_CONFIG_HOME;
    savedHome = process.env.HOME;
    process.env.XDG_CONFIG_HOME = join(root, "xdg");
    process.env.HOME = root;
    // Two workspaces, NO default → resolveConfig stashes a deferred error.
    writeFileSync(
      userConfigPath(),
      `[workspaces."org-a"]\napi_key = "lin_api_a000000000"\n` +
        `[workspaces."org-b"]\napi_key = "lin_api_b000000000"\n`,
    );
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    rmSync(root, { recursive: true, force: true });
  });

  function captureStdout(): { restore: () => void; text: () => string } {
    let out = "";
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
      out += c;
      return true;
    });
    return { restore: () => spy.mockRestore(), text: () => out };
  }

  it("auth list --json emits the bare credentials array (not a JSON error)", async () => {
    const cap = captureStdout();
    try {
      await createProgram().parseAsync(["node", "linear", "auth", "list", "--json"]);
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.text());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.map((e: any) => e.slug).sort()).toEqual(["org-a", "org-b"]);
  });

  it("auth default <slug> succeeds and persists the default", async () => {
    const cap = captureStdout();
    try {
      await createProgram().parseAsync(["node", "linear", "auth", "default", "org-b", "--json"]);
    } finally {
      cap.restore();
    }
    expect(JSON.parse(cap.text())).toMatchObject({ success: true, default_workspace: "org-b" });
    expect(readFileSync(userConfigPath(), "utf8")).toContain('default_workspace = "org-b"');
  });
});
