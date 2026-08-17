import { describe, it, expect, vi, afterEach, beforeEach } from "bun:test";
import { CommanderError, type Command } from "commander";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram, parsedGlobalOptions, usageHint, suppressedHelp } from "../../src/cli.js";
import { suggestSubcommand, commandPath } from "../../src/lib/options.js";
import { CliError } from "../../src/lib/errors.js";
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

/**
 * The boundary decides the error format from what commander parsed, wherever
 * on the command path the flag sat and under any spelling commander accepts.
 * `argv.includes("--json")` knew one spelling; `-j` got plaintext.
 */
describe("parsedGlobalOptions (what the error boundary reads)", () => {
  async function failedParse(argv: string[]) {
    silenceStdout();
    const program = createProgram();
    await program.parseAsync(["node", "linear", ...argv]).catch(() => {});
    return parsedGlobalOptions(program);
  }

  it("nothing parsed → no globals", async () => {
    expect(await failedParse(["whoami", "--nope"])).toEqual({});
  });

  it("reads --json off the leaf after a parse-time failure", async () => {
    expect((await failedParse(["whoami", "--nope", "--json"])).json).toBe(true);
  });

  it("reads the -j alias, and bundled short flags (-jq)", async () => {
    expect((await failedParse(["whoami", "--nope", "-j"])).json).toBe(true);
    const bundled = await failedParse(["whoami", "--nope", "-jq"]);
    expect(bundled.json).toBe(true);
    expect(bundled.quiet).toBe(true);
  });

  it("finds the flag wherever on the path it was given", async () => {
    expect((await failedParse(["-j", "issue", "view", "--nope"])).json).toBe(true);
    expect((await failedParse(["issue", "-j", "view", "--nope"])).json).toBe(true);
  });

  it("reads --debug and --no-ansi / --no-color the same way", async () => {
    const g = await failedParse(["whoami", "--nope", "--debug", "--no-color"]);
    expect(g.debug).toBe(true);
    expect(g.noAnsi).toBe(true);
  });

  it("does not report a flag the user did not pass (no defaults leak in)", async () => {
    const g = await failedParse(["issue", "view", "--nope"]);
    expect(g.json).toBeUndefined();
    expect(g.noAnsi).toBeUndefined();
    expect(g.debug).toBeUndefined();
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

// Phase 3 of the alignment: capability gaps. These pin the *option surface* —
// the service-level filter shapes live in issue-filter.test.ts.
describe("linear-cli capability gaps (phase 3)", () => {
  const program = createProgram();
  const find = (path: string[]): Command =>
    path.reduce<Command | undefined>(
      (cmd, name) => cmd?.commands.find((c) => c.name() === name || c.aliases().includes(name)),
      program,
    )!;
  const option = (cmd: Command, long: string) => cmd.options.filter((o) => o.long === long);
  const queries = ["list", "mine", "search"];

  // The mechanism that makes a repeatable --team possible: cli.ts injects the
  // globals onto every command, and must NOT re-add a single-valued --team over
  // the queries' collector (last-key-wins would look like it worked).
  it("gives the issue queries exactly one --team, and it collects", () => {
    for (const name of queries) {
      const teamOptions = option(find(["issue", name]), "--team");
      expect(teamOptions).toHaveLength(1);
      const parse = teamOptions[0]!.parseArg!;
      expect(parse("TES", undefined as any)).toEqual(["TES"]);
      expect(parse("ENG", ["TES"] as any)).toEqual(["TES", "ENG"]);
    }
  });

  it("leaves --team single-valued everywhere else", () => {
    for (const path of [["issue", "create"], ["issue", "update"], ["project", "create"]]) {
      const teamOptions = option(find(path), "--team");
      expect(teamOptions).toHaveLength(1);
      expect(teamOptions[0]!.parseArg).toBeUndefined();
    }
  });

  it("makes --state repeatable on the issue queries", () => {
    for (const name of queries) {
      const parse = option(find(["issue", name]), "--state")[0]!.parseArg!;
      expect(parse("started", undefined as any)).toEqual(["started"]);
      expect(parse("In Review", ["started"] as any)).toEqual(["started", "In Review"]);
    }
  });

  it("registers -U/--unassigned where an assignee filter exists, and nowhere else", () => {
    for (const name of ["list", "search"]) {
      const unassigned = option(find(["issue", name]), "--unassigned")[0];
      expect(unassigned?.short).toBe("-U");
    }
    // `issue mine` is fixed to the viewer, so "unassigned" would contradict it.
    expect(option(find(["issue", "mine"]), "--unassigned")).toHaveLength(0);
  });

  it("adds the project-label, milestone and date filters to all three queries", () => {
    for (const name of queries) {
      const flags = find(["issue", name]).options.map((o) => o.long);
      expect(flags).toContain("--project-label");
      expect(flags).toContain("--milestone");
      expect(flags).toContain("--created-after");
      expect(flags).toContain("--updated-after");
    }
  });

  // AUDIT.md #8: the global --team was accepted here and silently ignored.
  it("documents --team on `issue update` as a move", () => {
    expect(option(find(["issue", "update"]), "--team")[0]!.description).toMatch(/move/i);
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

/**
 * TES-633: the root has an action (bare `linear` shows the branch's issue) and
 * `issue` has a default subcommand (`view`), so commander's own "unknown
 * command" never fired for either — a stray word was "too many arguments.
 * Expected 0 arguments but got 2: issues, list." at the root and "'lst' is not
 * a valid issue id" under `issue`. Both now say what the word probably was.
 */
describe("unknown commands (TES-633)", () => {
  const parse = async (argv: string[]) => {
    silenceStdout();
    try {
      await createProgram().parseAsync(["node", "linear", ...argv]);
      throw new Error("expected a throw");
    } catch (err) {
      return err as any;
    }
  };

  it("a stray word at the root is an unknown command, with a guess", async () => {
    const err = await parse(["issues", "list"]);
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe("usage");
    expect(err.message).toBe(
      "Unknown command 'issues'. Did you mean 'issue'? Run 'linear --help' to see the commands.",
    );
  });

  it("no guess when nothing is close", async () => {
    const err = await parse(["xyzzy"]);
    expect(err.message).toBe("Unknown command 'xyzzy'. Run 'linear --help' to see the commands.");
  });

  it("`issue <word>` that is neither an id nor a subcommand names the likely subcommand", async () => {
    const err = await parse(["issue", "lst"]);
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe("usage");
    expect(err.message).toContain("'lst' is not a valid issue id");
    expect(err.message).toContain("Did you mean 'linear issue list'?");
  });

  it("suggestSubcommand: prefixes, one-edit typos, aliases — but not two-letter aliases", () => {
    const program = createProgram();
    expect(suggestSubcommand(program, "proj")).toBe("project");
    expect(suggestSubcommand(program, "lable")).toBe("label");
    expect(suggestSubcommand(program, "issues")).toBe("issue");
    expect(suggestSubcommand(program, "docs")).toBe("document");
    expect(suggestSubcommand(program, "notif")).toBe("notification");
    // `ab` is one edit from the alias `lb`; that is noise, not a guess.
    expect(suggestSubcommand(program, "ab")).toBeUndefined();
    expect(suggestSubcommand(program, "xyzzy")).toBeUndefined();
  });

  it("commandPath spells the command the way a user types it", () => {
    const program = createProgram();
    const issue = program.commands.find((c) => c.name() === "issue")!;
    const create = issue.commands.find((c) => c.name() === "create")!;
    expect(commandPath(program)).toBe("linear");
    expect(commandPath(create)).toBe("linear issue create");
  });

  it("usageHint names the command whose parse failed, and nothing when none did", async () => {
    silenceStdout();
    const program = createProgram();
    expect(usageHint(program)).toBeUndefined();
    await program.parseAsync(["node", "linear", "issue", "create", "--nope"]).catch(() => {});
    expect(usageHint(program)).toBe("Run 'linear issue create --help' for usage.");
  });

  it("a bare group buffers commander's help for the boundary instead of losing it", async () => {
    silenceStdout();
    const program = createProgram();
    const err = await program.parseAsync(["node", "linear", "notification"]).catch((e) => e);
    expect(err).toBeInstanceOf(CommanderError);
    expect(err.code).toBe("commander.help");
    const help = suppressedHelp(program);
    expect(help?.command.name()).toBe("notification");
    expect(help?.text).toContain("Usage: linear notification|notif");
  });
});
