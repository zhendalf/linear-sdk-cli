import { describe, it, expect, vi, afterEach } from "bun:test";
import { Command } from "commander";
import {
  collectKeyVal,
  collectArray,
  parseList,
  parseIntOption,
  parsePositiveInt,
  parsePriority,
  addAliasOption,
  readAlias,
  assertGlobalsApply,
  subcommandPath,
  FIELDS_COMMANDS,
  LIMIT_COMMANDS,
} from "../../src/lib/options.js";
import { CliError } from "../../src/lib/errors.js";
import { Context } from "../../src/context.js";
import { createProgram } from "../../src/cli.js";
import { walkCommands } from "../../src/lib/introspect.js";
import { withRetry, setRetryReporter } from "../../src/client.js";

/**
 * Parse `argv` with the REAL program and hand back both the leaf command's own
 * options and the merged view `action()` actually builds the Context from.
 *
 * These tests deliberately go through `createProgram()` and assert on
 * commander's own keys. The dead `--no-input` survived a full test suite
 * because everything asserted against `GlobalOptions`, our hand-written
 * description of what commander stores — and that description was wrong. A test
 * of the interface could never have caught it; only a test of the parser can.
 */
function parseAt(path: string[], argv: string[]): { local: any; merged: any } {
  const program = createProgram();
  let cmd: Command = program;
  for (const name of path) {
    cmd = cmd.commands.find((c) => c.name() === name)!;
    expect(cmd).toBeDefined();
  }
  let result: { local: any; merged: any } | undefined;
  // Replace the registered action so nothing touches the network.
  (cmd as any)._actionHandler = null;
  cmd.action(function (this: unknown, ..._args: unknown[]) {
    result = { local: cmd.opts(), merged: cmd.optsWithGlobals() };
  });
  program.parse(argv, { from: "user" });
  return result!;
}

/** Every command in the tree, depth-first. */
function allCommands(cmd: Command, acc: Command[] = []): Command[] {
  acc.push(cmd);
  for (const sub of cmd.commands) allCommands(sub, acc);
  return acc;
}

describe("collectKeyVal", () => {
  it("accumulates key=value pairs", () => {
    const acc = collectKeyVal("a=1", {});
    expect(collectKeyVal("b=2", acc)).toEqual({ a: "1", b: "2" });
  });
  it("supports '=' in the value", () => {
    expect(collectKeyVal("token=ab=cd", {})).toEqual({ token: "ab=cd" });
  });
  it("throws on missing '='", () => {
    expect(() => collectKeyVal("bad", {})).toThrow(CliError);
  });
});

describe("collectArray", () => {
  it("appends values", () => {
    expect(collectArray("b", collectArray("a", []))).toEqual(["a", "b"]);
  });
});

describe("parseList", () => {
  it("splits comma lists and accumulates", () => {
    expect(parseList("a,b", parseList("c", []))).toEqual(["c", "a", "b"]);
  });
  it("trims and drops empties", () => {
    expect(parseList(" a , , b ", [])).toEqual(["a", "b"]);
  });
});

describe("parseIntOption", () => {
  it("parses integers, including negatives", () => {
    expect(parseIntOption("42")).toBe(42);
    expect(parseIntOption("0")).toBe(0);
    expect(parseIntOption("-3")).toBe(-3);
  });
  it("throws on non-numbers", () => {
    expect(() => parseIntOption("abc")).toThrow(CliError);
  });
  // `Number.parseInt` stops at the first character it cannot use, so these used
  // to succeed with a value the user never typed: `--priority 1.9` silently
  // became 1 and `--estimate 2junk` silently became 2.
  it("rejects a value that is only PARTLY an integer, instead of truncating it", () => {
    expect(() => parseIntOption("1.9")).toThrow(/got '1\.9'/);
    expect(() => parseIntOption("2junk")).toThrow(/got '2junk'/);
    expect(() => parseIntOption("3px")).toThrow(CliError);
    expect(() => parseIntOption("1e3")).toThrow(CliError);
    expect(() => parseIntOption("")).toThrow(CliError);
    expect(() => parseIntOption(" 4")).toThrow(CliError);
    expect(() => parseIntOption("4 ")).toThrow(CliError);
  });
});

describe("parsePriority", () => {
  it("accepts the whole 0–4 range Linear defines", () => {
    expect([0, 1, 2, 3, 4].map((n) => parsePriority(String(n)))).toEqual([0, 1, 2, 3, 4]);
  });
  it("rejects out-of-range values locally, naming what the numbers mean", () => {
    expect(() => parsePriority("5")).toThrow(/Invalid priority '5'.*1 \(urgent\)/);
    expect(() => parsePriority("-1")).toThrow(CliError);
  });
  it("inherits the complete-integer rule", () => {
    expect(() => parsePriority("1.9")).toThrow(/got '1\.9'/);
  });
});

describe("--priority is validated at the CLI boundary", () => {
  it("rejects a truncatable value on an issue query rather than filtering on 1", () => {
    expect(() => parseAt(["issue", "list"], ["issue", "list", "--priority", "1.9"])).toThrow(
      /got '1\.9'/,
    );
  });
  it("rejects an out-of-range priority", () => {
    expect(() => parseAt(["issue", "list"], ["issue", "list", "--priority", "9"])).toThrow(
      /Invalid priority '9'/,
    );
  });
  it("passes a valid priority through as the canonical string the filter consumes", () => {
    const { local } = parseAt(["issue", "list"], ["issue", "list", "--priority", "2"]);
    expect(local.priority).toBe("2");
  });
});

describe("parsePositiveInt (--limit)", () => {
  it("accepts positive integers", () => {
    expect(parsePositiveInt("1")).toBe(1);
    expect(parsePositiveInt("50")).toBe(50);
  });
  // The reference CLI spells "no limit" as `--limit 0`; Context.limit maps it
  // onto --all rather than the 50-row default.
  it("accepts zero (the reference CLI's spelling of --all)", () => {
    expect(parsePositiveInt("0")).toBe(0);
  });
  it("rejects negatives, decimals, and trailing junk", () => {
    expect(() => parsePositiveInt("-1")).toThrow(CliError);
    expect(() => parsePositiveInt("1.5")).toThrow(CliError);
    expect(() => parsePositiveInt("12x")).toThrow(/got '12x'/);
  });
  it("rejects leading zeros (including '00')", () => {
    expect(() => parsePositiveInt("01")).toThrow(CliError);
    expect(() => parsePositiveInt("00")).toThrow(CliError);
  });
});

describe("Context.limit", () => {
  it("--limit 0 exhausts pagination, exactly like --all", () => {
    expect(new Context({ limit: 0 }).limit).toBe(Infinity);
    expect(new Context({ all: true }).limit).toBe(Infinity);
  });
  it("leaves the existing limit/default behavior alone", () => {
    expect(new Context({ limit: 7 }).limit).toBe(7);
    expect(new Context({}).limit).toBe(50);
  });
});

/**
 * AUDIT #3. Two separate defects hid behind one dead flag, and each needs its
 * own assertion against the parser:
 *
 *   a) the key. Commander stores a negation under the name with `no-` stripped,
 *      so `--no-input` was `input: false` while `Context` read `noInput`.
 *   b) the merge. A lone negation is ALSO seeded with a default of `true` on
 *      every command, and `optsWithGlobals()` lets ancestors overwrite
 *      descendants — so with `enablePositionalOptions()` the root's default
 *      `true` overwrote the subcommand's parsed `false`. Fixing (a) alone would
 *      have left the flag just as dead, which is why (b) has its own test.
 */
describe("--no-input (AUDIT #3)", () => {
  it("parses into the key Context reads — asserted on commander's output, not on GlobalOptions", () => {
    const { local } = parseAt(["whoami"], ["whoami", "--no-input"]);
    expect(local.noInput).toBe(true);
    // The old key must not reappear: if commander ever stores `input` again,
    // `noInput` is a lie once more and this catches it.
    expect(local).not.toHaveProperty("input");
  });

  it("survives the ancestor merge when passed AFTER the subcommand", () => {
    const { merged } = parseAt(["label", "delete"], ["label", "delete", "bug", "--no-input"]);
    expect(merged.noInput).toBe(true);
  });

  it("works passed BEFORE the subcommand too", () => {
    const { merged } = parseAt(["label", "delete"], ["--no-input", "label", "delete", "bug"]);
    expect(merged.noInput).toBe(true);
  });

  it("is absent — not defaulted — when it was never passed", () => {
    // A default is what made the ancestor merge destructive; there must not be one.
    const { merged } = parseAt(["label", "delete"], ["label", "delete", "bug"]);
    expect(merged.noInput).toBeUndefined();
  });
});

describe("Context.isTTY refuses to prompt (AUDIT #3)", () => {
  it("honors --no-input", () => {
    expect(new Context({ noInput: true }).isTTY).toBe(false);
  });
  it("treats --json as non-interactive: an agent piping output must never be asked a question", () => {
    expect(new Context({ json: true }).isTTY).toBe(false);
  });
  it("requires a TTY on both stdin and stdout", () => {
    // inquirer draws the prompt on stdout, so a redirected stdout would write
    // the question into the caller's output.
    expect(new Context({}).isTTY).toBe(process.stdin.isTTY === true && process.stdout.isTTY === true);
  });
});

/**
 * AUDIT #4. The global terminal-colour flag and the entity `--color <hex>` used
 * to share commander's `color` attribute, so `--no-color` put `color: false`
 * into a mutation input.
 */
describe("--no-color vs --color <hex> (AUDIT #4)", () => {
  it("lets one invocation set an entity colour AND disable terminal colour", () => {
    const { local, merged } = parseAt(
      ["label", "create"],
      ["label", "create", "--name", "x", "--color", "#EB5757", "--no-color"],
    );
    expect(local.color).toBe("#EB5757");
    expect(merged.color).toBe("#EB5757");
    expect(merged.noAnsi).toBe(true);
  });

  it("the canonical spelling --no-ansi does the same", () => {
    const { merged } = parseAt(
      ["label", "create"],
      ["label", "create", "--name", "x", "--color", "#EB5757", "--no-ansi"],
    );
    expect(merged.color).toBe("#EB5757");
    expect(merged.noAnsi).toBe(true);
  });

  it("--no-color alone leaves `color` untouched, so it cannot reach a mutation input", () => {
    const { local } = parseAt(["label", "create"], ["label", "create", "--name", "x", "--no-color"]);
    expect(local.color).toBeUndefined();
    expect(local.color).not.toBe(false);
    expect(local.noAnsi).toBe(true);
  });

  it("both spellings land on the same key, on a command with no entity --color", () => {
    // Asserting the key rather than `Context.output.color`: the test process has
    // no TTY, so colour is already off and that assertion would pass either way.
    for (const argv of [
      ["whoami", "--no-color"],
      ["whoami", "--no-ansi"],
    ]) {
      expect(parseAt(["whoami"], argv).merged.noAnsi).toBe(true);
    }
    expect(parseAt(["whoami"], ["whoami"]).merged.noAnsi).toBeUndefined();
  });

  it("structurally: no option anywhere in the tree can write `false` into `color`", () => {
    // The guarantee, not an instance of it. Any future command that adds a
    // `--color <hex>` is covered without a new test.
    for (const cmd of allCommands(createProgram())) {
      const owners = cmd.options.filter((o) => o.attributeName() === "color");
      expect(owners.every((o) => !(o as any).negate)).toBe(true);
      expect(owners.length).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * AUDIT #8 — the global `-t/--team` is advertised on every command, including
 * ones that cannot honor it. `project update --team X` was accepted and dropped
 * without a word.
 */
describe("project update --team (AUDIT #8)", () => {
  const projectUpdate = () =>
    createProgram()
      .commands.find((c) => c.name() === "project")!
      .commands.find((c) => c.name() === "update")!;

  it("rejects it by name, and points at the flag that works", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(["node", "linear", "project", "update", "some-project", "--team", "TES"]),
    ).rejects.toThrow(/--team does not apply to `project update`.*Use --teams/s);
  });

  it("rejects it even when combined with a field that would have succeeded", async () => {
    // The silent-drop case: previously `--team` vanished and the update went
    // through, so the user believed the team had been set.
    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "linear",
        "project",
        "update",
        "some-project",
        "--name",
        "x",
        "--team",
        "TES",
      ]),
    ).rejects.toThrow(/--team does not apply/);
  });

  it("is not advertised: --help and `linear commands` show only --teams", () => {
    const help = projectUpdate().helpInformation();
    expect(help).toContain("--teams <key>");
    expect(help).not.toContain("--team <key>");
  });

  it("the global is not injected on top of the local declaration", () => {
    // addGlobalOptions must leave a locally-declared global alone; two `--team`
    // options on one command would be a parser-level ambiguity.
    const teamOptions = projectUpdate().options.filter((o) => o.long === "--team");
    expect(teamOptions).toHaveLength(1);
  });

  it("leaves `project create --team` alone, where it IS the fallback team", () => {
    const create = createProgram()
      .commands.find((c) => c.name() === "project")!
      .commands.find((c) => c.name() === "create")!;
    expect(create.options.some((o) => o.long === "--team")).toBe(true);
  });
});

/**
 * TES-637 (2) / TES-596. `--fields`, `--limit` and `--all` are registered on
 * every command but read only by the ones that render a table or detail block
 * (fields) or page through a query (limit/all). Everywhere else they vanished
 * without a word — and schpet's `-f` is `--description-file` on `project
 * create`, so `linear project create --name X -f desc.md` created the project
 * with NO description and exited 0. The guard runs before the action, so a
 * misread flag costs an error message, never a mutation.
 */
describe("--fields / --limit / --all are refused where nothing reads them (TES-637 #2, TES-596)", () => {
  /** Whether the leaf's (replaced) action ran during the last `run`. */
  let ran = false;
  /** Parse with the real program; the leaf's action is replaced so nothing touches the network. */
  async function run(path: string[], argv: string[]): Promise<{ ran: boolean }> {
    const program = createProgram();
    let cmd: Command = program;
    for (const name of path) cmd = cmd.commands.find((c) => c.name() === name)!;
    ran = false;
    (cmd as any)._actionHandler = null;
    cmd.action(() => {
      ran = true;
    });
    await program.parseAsync(["node", "linear", ...argv]);
    return { ran };
  }
  const leaf = (path: string[]): Command => {
    let cmd: Command = createProgram();
    for (const name of path) cmd = cmd.commands.find((c) => c.name() === name)!;
    return cmd;
  };

  it("`project create -f desc.md` is a usage error that names --description-file, before the action runs", async () => {
    await expect(
      run(["project", "create"], ["project", "create", "--name", "X", "-f", "desc.md"]),
    ).rejects.toThrow(
      /--fields does not apply to `linear project create`.*--description-file <path> or --content-file <path>.*-f is --fields here/,
    );
    expect(ran).toBe(false);
  });

  it("names --content-file on `document create` / `document update`, and only that (no --description-file there)", async () => {
    await expect(
      run(["document", "create"], ["document", "create", "--title", "T", "-f", "body.md"]),
    ).rejects.toThrow(/use --content-file <path> \(-f is --fields here/);
    await expect(
      run(["document", "update"], ["document", "update", "some-id", "--fields", "body.md"]),
    ).rejects.toThrow(/does not apply to `linear document update`.*--content-file/);
  });

  it("is refused on a plain mutation with no file option, without the file hint", async () => {
    await expect(run(["label", "delete"], ["label", "delete", "bug", "--fields", "name"])).rejects.toThrow(
      /--fields does not apply to `linear label delete`: it prints a receipt/,
    );
    await expect(run(["label", "delete"], ["label", "delete", "bug", "--fields", "name"])).rejects.not.toThrow(
      /--content-file/,
    );
  });

  it("is refused wherever on the command line the flag sat (root position too)", async () => {
    await expect(run(["issue", "archive"], ["-f", "id", "issue", "archive", "TES-1"])).rejects.toThrow(
      /--fields does not apply to `linear issue archive`/,
    );
  });

  it("the error is a usage error (exit 2), and the action never runs", async () => {
    let err: any;
    try {
      await run(["project", "archive"], ["project", "archive", "P", "--fields", "id"]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe("usage");
  });

  it("--limit / --all are refused on a command that pages nothing; -n gets the --name hint where there is one", async () => {
    await expect(
      run(["project", "create"], ["project", "create", "-n", "5"]),
    ).rejects.toThrow(/--limit does not apply to `linear project create`.*-n is --limit here; the name is --name <name>/);
    await expect(run(["issue", "view"], ["issue", "view", "TES-1", "--limit", "5"])).rejects.toThrow(
      /--limit does not apply to `linear issue view`: it is not a paged query\./,
    );
    await expect(run(["issue", "view"], ["issue", "view", "TES-1", "--limit", "5"])).rejects.not.toThrow(
      /--name/,
    );
    await expect(run(["issue", "create"], ["issue", "create", "--title", "x", "--all"])).rejects.toThrow(
      /--all does not apply to `linear issue create`/,
    );
  });

  it("still lets every renderer take --fields, and every paged query take --limit/--all", async () => {
    expect((await run(["project", "list"], ["project", "list", "--fields", "name", "--limit", "5"])).ran).toBe(true);
    expect((await run(["project", "view"], ["project", "view", "P", "-f", "name"])).ran).toBe(true);
    expect((await run(["issue", "mine"], ["issue", "mine", "--all", "-f", "id,title"])).ran).toBe(true);
    expect((await run(["whoami"], ["whoami", "--fields", "email"])).ran).toBe(true);
    expect((await run(["milestone", "view"], ["milestone", "view", "M", "--limit", "3"])).ran).toBe(true);
    expect((await run(["team", "members"], ["team", "members", "--all"])).ran).toBe(true);
    // The mounted copy of `comment list` under `issue` is its own Command instance.
    expect((await run(["issue", "comment", "list"], ["issue", "comment", "list", "TES-1", "-f", "body", "-n", "2"])).ran).toBe(true);
    // Root position works for a renderer, exactly as before.
    expect((await run(["user", "list"], ["-f", "email", "--all", "user", "list"])).ran).toBe(true);
  });

  it("the applicability tables name only commands that exist (a rename or removal shows up here)", () => {
    const paths = new Set(walkCommands(createProgram()).map((n) => n.path));
    for (const p of FIELDS_COMMANDS) expect(paths.has(p), `FIELDS_COMMANDS: '${p}'`).toBe(true);
    for (const p of LIMIT_COMMANDS) expect(paths.has(p), `LIMIT_COMMANDS: '${p}'`).toBe(true);
    // Paging without rendering makes no sense: every paged query renders.
    for (const p of LIMIT_COMMANDS) expect(FIELDS_COMMANDS.has(p), `'${p}' pages but does not render`).toBe(true);
  });

  it("subcommandPath spells the path the way `linear commands --json` does, and is empty for the root", () => {
    expect(subcommandPath(leaf(["issue", "comment", "list"]))).toBe("issue comment list");
    expect(subcommandPath(leaf(["whoami"]))).toBe("whoami");
    expect(subcommandPath(createProgram())).toBe("");
  });

  it("does not fire for the bare `linear` root action, which renders the branch's issue", () => {
    // assertGlobalsApply on the root is a no-op whatever the flags say.
    const program = createProgram();
    program.setOptionValue("fields", ["id"]);
    program.setOptionValue("limit", 3);
    expect(() => assertGlobalsApply(program)).not.toThrow();
  });
});

describe("readAlias (long-flag aliases)", () => {
  it("reads either spelling, camel-casing the option key like commander", () => {
    expect(readAlias<string>({ due: "2026-01-01" }, "--due", "--due-date")).toBe("2026-01-01");
    expect(readAlias<string>({ dueDate: "2026-01-01" }, "--due", "--due-date")).toBe(
      "2026-01-01",
    );
    expect(readAlias({}, "--due", "--due-date")).toBeUndefined();
  });
  it("errors when both spellings are passed rather than silently picking one", () => {
    expect(() => readAlias({ due: "a", dueDate: "b" }, "--due", "--due-date")).toThrow(
      /Pass either --due or --due-date, not both/,
    );
    // Even when they agree — the rule is "one spelling", with no guessing.
    expect(() => readAlias({ due: "a", dueDate: "a" }, "--due", "--due-date")).toThrow(CliError);
  });
  it("handles multi-segment flags and value placeholders", () => {
    expect(readAlias<boolean>({ allStates: true }, "--all-states", "--every-state")).toBe(true);
    expect(readAlias<string>({ query: "x" }, "--query <text>", "--search <text>")).toBe("x");
  });
});

describe("addAliasOption", () => {
  it("registers the alias hidden, so --help and `linear commands` stay canonical", () => {
    const cmd = new Command("demo").option("--due <date>", "due date");
    addAliasOption(cmd, "--due-date <date>", "--due");
    const alias = cmd.options.find((o) => o.long === "--due-date");
    expect(alias).toBeDefined();
    expect((alias as any).hidden).toBe(true);
    expect(cmd.helpInformation()).not.toContain("--due-date");
    expect(cmd.helpInformation()).toContain("--due <date>");
  });

  it("parses the alias into the camel-cased key readAlias expects", () => {
    const cmd = new Command("demo").option("--due <date>", "due date").exitOverride();
    addAliasOption(cmd, "--due-date <date>", "--due");
    cmd.parse(["node", "demo", "--due-date", "2026-03-04"]);
    expect(readAlias<string>(cmd.opts(), "--due", "--due-date")).toBe("2026-03-04");
  });
});

/**
 * Rate-limit waits are announced through the Context's Output, so they obey
 * `--quiet` and land on stderr like every other status line — never on the
 * JSON stdout a script is parsing.
 */
describe("Context wires the retry reporter to Output.info", () => {
  class Ratelimited extends Error {
    type = "Ratelimited";
    status = 429;
    retryAfter = 1;
  }
  const flakyOnce = () => {
    let calls = 0;
    return async () => {
      if (calls++ === 0) throw new Ratelimited("Ratelimited");
      return "ok";
    };
  };
  const captureStderr = () => {
    let err = "";
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: any) => {
      err += c;
      return true;
    });
    return { text: () => err, restore: () => spy.mockRestore() };
  };
  const noSleep = { sleep: async () => {} };
  afterEach(() => setRetryReporter(null));

  it("announces the wait on stderr", async () => {
    new Context({});
    const cap = captureStderr();
    try {
      expect(await withRetry(flakyOnce(), noSleep)).toBe("ok");
    } finally {
      cap.restore();
    }
    expect(cap.text()).toMatch(/rate limited; retrying in 1s/);
  });

  it("--quiet silences it", async () => {
    new Context({ quiet: true });
    const cap = captureStderr();
    try {
      expect(await withRetry(flakyOnce(), noSleep)).toBe("ok");
    } finally {
      cap.restore();
    }
    expect(cap.text()).toBe("");
  });
});
