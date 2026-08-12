import { describe, it, expect, vi, afterEach, beforeEach } from "bun:test";
import { CommanderError, type Command } from "commander";
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

// Phase 2 of the linear-cli alignment: every alias below is additive. The point
// of these tests is that an alias can never be silently unhooked from the thing
// it aliases — each one asserts the alias and the original land on the same
// command object / option key, and that the original still behaves as before.
describe("linear-cli aliases", () => {
  const program = createProgram();
  const find = (path: string[]): Command | undefined =>
    path.reduce<Command | undefined>(
      (cmd, name) => cmd?.commands.find((c) => c.name() === name || c.aliases().includes(name)),
      program,
    );
  const flags = (cmd: Command | undefined): string[] =>
    (cmd?.options ?? []).map((o) => o.long ?? "").filter(Boolean);
  const visibleHelp = (cmd: Command | undefined): string => cmd?.helpInformation() ?? "";

  describe("short flags (2.1)", () => {
    it("adds -j for the global --json on every command", () => {
      const json = program.options.find((o) => o.long === "--json");
      expect(json?.short).toBe("-j");
      // Inherited by leaves, like the rest of the globals.
      expect(find(["issue", "list"])?.options.find((o) => o.long === "--json")?.short).toBe("-j");
    });

    it("adds -w wherever --web already exists, and nowhere else", () => {
      for (const path of [["issue", "view"], ["issue", "pull-request"]]) {
        expect(find(path)?.options.find((o) => o.long === "--web")?.short).toBe("-w");
      }
    });

    it("keeps every short flag to one meaning across the whole tree", () => {
      const meanings = new Map<string, Set<string>>();
      const walk = (cmd: Command): void => {
        for (const o of cmd.options) {
          if (o.short) {
            if (!meanings.has(o.short)) meanings.set(o.short, new Set());
            meanings.get(o.short)!.add(o.long ?? "");
          }
        }
        for (const sub of cmd.commands) walk(sub);
      };
      walk(program);
      expect(meanings.get("-j")).toEqual(new Set(["--json"]));
      expect(meanings.get("-w")).toEqual(new Set(["--web"]));
      const collisions = [...meanings].filter(([, longs]) => longs.size > 1);
      expect(collisions).toEqual([]);
    });
  });

  describe("long-flag aliases (2.2)", () => {
    // their spelling → ours, and the command it lives on.
    const cases: Array<[path: string[], alias: string, canonical: string]> = [
      [["issue", "create"], "--due-date", "--due"],
      [["issue", "update"], "--due-date", "--due"],
      [["issue", "list"], "--search", "--query"],
      [["issue", "mine"], "--search", "--query"],
      [["project", "list"], "--status", "--state"],
      [["project", "create"], "--start-date", "--start"],
      [["project", "create"], "--target-date", "--target"],
      [["project", "update"], "--start-date", "--start"],
      [["project", "update"], "--target-date", "--target"],
      [["milestone", "create"], "--target-date", "--target"],
      [["milestone", "update"], "--target-date", "--target"],
      [["initiative", "create"], "--target-date", "--target"],
      [["initiative", "update"], "--target-date", "--target"],
    ];

    for (const [path, alias, canonical] of cases) {
      it(`${path.join(" ")} accepts ${alias} for ${canonical}`, () => {
        const cmd = find(path);
        expect(cmd).toBeDefined();
        // Both spellings registered…
        expect(flags(cmd)).toContain(alias);
        expect(flags(cmd)).toContain(canonical);
        // …the alias hidden, the canonical one the only one in --help.
        expect(cmd!.options.find((o) => o.long === alias)!.hidden).toBe(true);
        expect(visibleHelp(cmd)).not.toContain(alias);
        expect(visibleHelp(cmd)).toContain(canonical);
      });
    }

    it("hides aliases from `linear commands` too, so agents see one spelling", () => {
      const listed = flagsFromIntrospection(find(["issue", "create"])!);
      expect(listed).toContain("--due");
      expect(listed).not.toContain("--due-date");
    });

    it("`issue list` accepts --all-states as the no-op it is (list is all-states)", () => {
      const list = find(["issue", "list"]);
      expect(flags(list)).toContain("--all-states");
      expect(list!.options.find((o) => o.long === "--all-states")!.hidden).toBe(true);
      // `issue mine`'s --all-states is a REAL flag and stays visible — Phase 1.
      const mine = find(["issue", "mine"]);
      expect(mine!.options.find((o) => o.long === "--all-states")!.hidden).toBeFalsy();
      expect(visibleHelp(mine)).toContain("--all-states");
    });
  });

  describe("command aliases (2.4)", () => {
    it("`issue query` is the same command object as `issue list`", () => {
      const list = find(["issue", "list"]);
      expect(find(["issue", "query"])).toBe(list!);
      expect(list!.aliases()).toEqual(["ls", "query"]);
    });

    // meta.ts binds one module-level `whoamiAction` to both commands, so the
    // pair cannot drift. Commander re-wraps every handler in its own listener,
    // which makes the shared function unreachable from the Command — so pin the
    // observable surface instead, and prove identical output live.
    it("`auth whoami` mirrors top-level `whoami`, not `auth status`", () => {
      const top = find(["whoami"]);
      const nested = find(["auth", "whoami"]);
      expect(top).toBeDefined();
      expect(nested).toBeDefined();
      expect(nested!.description()).toBe(top!.description());
      expect(argShape(nested!)).toEqual(argShape(top!));
      expect(flagsFromIntrospection(nested!)).toEqual(flagsFromIntrospection(top!));
      // `auth status` is a different command reporting where the key came from;
      // aliasing whoami onto it would hide the user the caller asked about.
      expect(find(["auth", "status"])!.description()).not.toBe(top!.description());
    });

    it("mounts add/list/update/delete under `issue comment` with the same shape as `comment`", () => {
      const issueComment = find(["issue", "comment"]);
      expect(issueComment).toBeDefined();
      const verbs = ["add", "list", "update", "delete"];
      expect(issueComment!.commands.map((c) => c.name()).sort()).toEqual([...verbs].sort());

      for (const verb of verbs) {
        const nested = issueComment!.commands.find((c) => c.name() === verb)!;
        const top = find(["comment", verb])!;
        // Same description, same positional shape, same local options — a
        // re-implementation that drifted from the shared factory would fail here.
        expect(nested.description()).toBe(top.description());
        expect(argShape(nested)).toEqual(argShape(top));
        expect(flagsFromIntrospection(nested)).toEqual(flagsFromIntrospection(top));
      }
    });

    it("keeps the short aliases off `issue comment` so they cannot shadow a body", () => {
      const issueComment = find(["issue", "comment"])!;
      for (const c of issueComment.commands) expect(c.aliases()).toEqual([]);
      // …while the top-level group keeps them.
      expect(find(["comment", "list"])!.aliases()).toContain("ls");
    });

    it("still treats a non-subcommand first operand as the issue id", () => {
      const issueComment = find(["issue", "comment"])!;
      expect(argShape(issueComment)).toEqual([
        { name: "id", required: false },
        { name: "body", required: false },
      ]);
      expect((issueComment as any)._actionHandler).toBeInstanceOf(Function);
    });
  });

  function argShape(cmd: Command): Array<{ name: string; required: boolean }> {
    return ((cmd as any).registeredArguments ?? []).map((a: any) => ({
      name: a.name(),
      required: a.required === true,
    }));
  }
  function flagsFromIntrospection(cmd: Command): string[] {
    return cmd.options.filter((o: any) => !o.hidden).map((o) => o.long ?? "");
  }
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
