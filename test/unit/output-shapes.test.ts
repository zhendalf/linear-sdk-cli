/**
 * The drift guard for `linear commands --json`'s `output` (TES-610).
 *
 * `OUTPUT_SHAPES` says what every command prints under `--json`. Nothing but
 * running the commands can prove that table honest — the receipts are object
 * literals at each emit site — so this file:
 *
 *  1. refuses a command the table does not mention (a new command cannot ship
 *     with an undocumented shape), and a table entry no command has;
 *  2. runs EVERY command that prints JSON through the real program with the
 *     omni client (`_omni.ts`), and holds each emitted object — every row of a
 *     list, the object of a view, the receipt of a mutation, each declared
 *     variant — against its declared shape with `matchesShape`;
 *  3. checks the discovery output describes itself (`commands --json` rows
 *     match `COMMAND_NODE_SHAPE`).
 *
 * The compile-time half lives in the services: `shape<IssueRow>({…})` cannot
 * name a key `IssueRow` lacks. The runtime half here is what catches a key the
 * interface promises but the query stopped selecting, and a receipt whose emit
 * site grew or lost a key.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";
import { walkCommands } from "../../src/lib/introspect.js";
import { COMMAND_NODE_SHAPE, OUTPUT_SHAPES } from "../../src/lib/output-shapes.js";
import { matchesShape, type OutputShape } from "../../src/lib/shape.js";
import { writeCredential } from "../../src/config.js";
import { setKeyringBackend } from "../../src/lib/keyring.js";
import { omniClient, setOverrides, UUID } from "./_omni.js";

// ---------------------------------------------------------------------------
// How to invoke each command so it prints its primary output, and each variant.
// ---------------------------------------------------------------------------

interface Drive {
  /** argv after the command path; the harness appends `--json`. */
  args: string[];
  /** argv per declared variant key. */
  variants?: Record<string, string[]>;
  /** Run in the temporary git repository instead of the plain directory. */
  git?: boolean;
  /** Scalar values the fake should answer with for this run (`archivedAt` for an unarchive, …). */
  overrides?: Record<string, unknown>;
  /** Nullable relation keys this invocation legitimately leaves null (`movedTo` without --move-issues). */
  nullOk?: string[];
  /** Not driven, and why. Kept short: this list should stay short. */
  skip?: string;
}

const T = "TES-1";
const DRIVES: Record<string, Drive> = {
  api: { args: [], skip: "raw" },
  "attachment create": { args: [T, "--url", "https://x.example", "--title", "t"] },
  "attachment delete": { args: [UUID, "--yes"] },
  "attachment list": { args: [T] },
  "auth adopt": { args: ["acme"], skip: "reads a real named OS-keyring credential" },
  "auth default": { args: ["acme"] },
  "auth list": { args: [] },
  "auth login": { args: [], skip: "validates the key with a fresh LinearClient (network)" },
  "auth logout": { args: ["acme", "--yes"] },
  "auth migrate": { args: [], skip: "requires an available OS keyring" },
  "auth status": { args: [], nullOk: ["scopes"] },
  "auth token": { args: [] },
  "auth whoami": { args: [] },
  commands: { args: [], variants: { "[path]": ["issue", "list"] } },
  "comment add": { args: [T, "hello"] },
  "comment delete": { args: [UUID, "--yes"] },
  "comment list": { args: [T] },
  "comment reply": { args: [UUID, "hello"] },
  "comment resolve": { args: [UUID] },
  "comment unresolve": { args: [UUID] },
  "comment update": { args: [UUID, "a new body"] },
  completion: { args: [], skip: "none" },
  config: { args: [] },
  "config init": { args: ["--team", "TES", "--path", "init.toml", "--force"] },
  "config set": { args: ["team", "TES", "--path", "set.toml"] },
  "config show": { args: [] },
  "cycle create": { args: ["--start", "2026-01-01", "--end", "2026-01-15"] },
  "cycle current": { args: [] },
  "cycle list": { args: [] },
  "cycle update": { args: [UUID, "--name", "n"] },
  "cycle view": { args: [UUID] },
  document: { args: [UUID] },
  "document create": { args: ["--title", "t", "--project", "Name"] },
  "document delete": { args: [UUID, "--yes"] },
  "document list": { args: [] },
  "document update": { args: [UUID, "--title", "t2"] },
  "document view": { args: [UUID] },
  "favorite add": { args: ["--issue", T] },
  "favorite list": { args: [] },
  "favorite remove": { args: [UUID, "--yes"] },
  initiative: { args: [UUID] },
  "initiative add-project": { args: [UUID, UUID] },
  "initiative archive": { args: [UUID, "--yes"] },
  "initiative create": { args: ["--name", "n"] },
  "initiative delete": { args: [UUID, "--yes"] },
  "initiative list": { args: [] },
  "initiative remove-project": { args: [UUID, UUID, "--yes"] },
  "initiative unarchive": {
    args: [UUID],
    overrides: { archivedAt: new Date("2026-01-02T00:00:00.000Z") },
  },
  "initiative update": { args: [UUID, "--name", "n2"] },
  "initiative view": { args: [UUID] },
  "initiative-update create": { args: [UUID, "--body", "b"] },
  "initiative-update list": { args: [UUID] },
  issue: {
    args: [T],
    variants: {
      "--web": ["SKIP: opens a browser"],
      "--app": ["SKIP: opens Linear.app"],
    },
  },
  "issue agent-session list": { args: [T] },
  "issue agent-session view": { args: [UUID] },
  "issue archive": {
    args: [T, "--yes"],
    variants: { "--bulk": ["--bulk", "TES-1,TES-2", "--yes"] },
  },
  "issue assign": { args: [T, "me"] },
  "issue attach": { args: [T, "FILE"] },
  "issue branch": { args: [T] },
  "issue comment": { args: [T, "hello"] },
  "issue comment add": { args: [T, "hello"] },
  "issue comment delete": { args: [UUID, "--yes"] },
  "issue comment list": { args: [T] },
  "issue comment update": { args: [UUID, "a new body"] },
  "issue comments": { args: [T] },
  "issue create": { args: ["--title", "t"], variants: { "--start": ["--title", "t", "--start"] } },
  "issue delete": {
    args: [T, "--yes"],
    variants: { "--bulk": ["--bulk", "TES-1,TES-2", "--yes"] },
  },
  "issue describe": { args: [T] },
  "issue id": { args: [T] },
  "issue label": { args: [T, "--add", "Name"] },
  "issue list": { args: [] },
  "issue mine": { args: [] },
  "issue pull-request": {
    args: [T],
    skip: "spawns `gh` with execFileSync, which under Bun resolves the binary from the launch-time PATH — a fake gh cannot be put in front of it from inside the test",
  },
  "issue relation": { args: [T, "add", "TES-2"], variants: { "op=list": [T, "list"] } },
  "issue search": { args: ["login"] },
  "issue start": { args: [T, "--no-checkout"] },
  "issue state": { args: [T, "started"] },
  "issue subscribe": { args: [T] },
  "issue title": { args: [T] },
  "issue unarchive": { args: [T] },
  "issue unsubscribe": { args: [T] },
  "issue update": { args: [T, "--title", "t2"] },
  "issue url": { args: [T] },
  "issue view": {
    args: [T],
    // --web opens a browser; the receipt is three fields off the detail plus `opened`.
    variants: {
      "--web": ["SKIP: opens a browser"],
      "--app": ["SKIP: opens Linear.app"],
    },
  },
  "label create": { args: ["--name", "n"] },
  "label delete": { args: [UUID, "--yes"] },
  "label list": { args: [] },
  "label update": { args: [UUID, "--name", "n2"] },
  "milestone create": { args: [UUID, "--name", "n"] },
  "milestone delete": { args: [UUID, "--yes"] },
  "milestone list": { args: [UUID] },
  "milestone update": { args: [UUID, "--name", "n2"] },
  "milestone view": { args: [UUID] },
  "notification archive": { args: [UUID, "--yes"] },
  "notification list": { args: [] },
  "notification read": { args: [UUID] },
  "notification read-all": { args: [] },
  "notification snooze": { args: [UUID, "2026-03-01T00:00:00.000Z"] },
  "notification unread": { args: [UUID] },
  open: { args: [], skip: "opens the system browser" },
  organization: { args: [] },
  "organization invites": { args: [] },
  "organization members": { args: [] },
  "organization view": { args: [] },
  project: { args: [UUID] },
  "project archive": { args: [UUID, "--yes"] },
  "project create": { args: ["--name", "n"] },
  "project delete": { args: [UUID, "--yes"] },
  "project list": { args: [] },
  "project milestones": { args: [UUID] },
  "project update": { args: [UUID, "--name", "n2"] },
  "project view": { args: [UUID] },
  "project-update create": { args: [UUID, "--body", "b"] },
  "project-update list": { args: [UUID] },
  roadmap: { args: [UUID] },
  "roadmap create": { args: ["--name", "n"] },
  "roadmap delete": { args: [UUID, "--yes"] },
  "roadmap list": { args: [] },
  "roadmap update": { args: [UUID, "--name", "n2"] },
  "roadmap view": { args: [UUID] },
  schema: { args: [], skip: "raw" },
  "state list": { args: [] },
  "state view": { args: [UUID] },
  "team create": { args: ["--name", "n", "--key", "NEW"] },
  "team cycles": { args: [] },
  "team delete": { args: ["TES", "--yes"], nullOk: ["movedTo"] },
  "team id": { args: ["TES"] },
  "team labels": { args: [] },
  "team list": { args: [] },
  "team members": { args: [] },
  "team states": { args: [] },
  "team update": { args: ["TES", "--name", "n2"] },
  "team view": { args: [] },
  "user list": { args: [] },
  "user me": { args: [] },
  "user view": { args: ["me"] },
  webhook: { args: [UUID] },
  "webhook create": { args: ["--url", "https://x.example/hook", "--resource", "Issue"] },
  "webhook delete": { args: [UUID, "--yes"] },
  "webhook list": { args: [] },
  "webhook update": { args: [UUID, "--label", "l"] },
  "webhook view": { args: [UUID] },
  whoami: { args: [] },
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let plainDir: string;
let gitDir: string;
let savedCwd: string;
let savedEnv: Record<string, string | undefined>;
let clientDescriptor: PropertyDescriptor | undefined;
let savedFetch: typeof globalThis.fetch;

beforeAll(() => {
  // This broad command sweep changes HOME and exercises credential commands;
  // it is not a Keychain integration test. Keep it incapable of touching the
  // developer's macOS keychain even if another test changed detection state.
  setKeyringBackend(null);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "linshapes-")));
  plainDir = join(root, "plain");
  gitDir = join(root, "git");
  mkdirSync(plainDir);
  mkdirSync(gitDir);
  execFileSync("git", ["init", "-q"], { cwd: gitDir });
  writeFileSync(join(plainDir, "shot.png"), "not really a png");

  savedCwd = process.cwd();
  savedEnv = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    HOME: process.env.HOME,
    LINEAR_API_KEY: process.env.LINEAR_API_KEY,
    LINEAR_TEAM: process.env.LINEAR_TEAM,
  };
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  process.env.HOME = root;
  process.env.LINEAR_API_KEY = "lin_api_test000000000000";
  process.env.LINEAR_TEAM = "TES";
  // A stored credential for `auth default` / `auth logout` / `auth list` to act on.
  writeCredential("acme", "lin_api_stored0000000000", { plaintext: true });

  clientDescriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
  Object.defineProperty(Context.prototype, "client", {
    get: () => omniClient(),
    configurable: true,
  });
  savedFetch = globalThis.fetch;
  // `issue attach` PUTs bytes to the signed URL; answer 200 without a network.
  globalThis.fetch = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
});

afterAll(() => {
  setKeyringBackend(undefined);
  if (clientDescriptor) Object.defineProperty(Context.prototype, "client", clientDescriptor);
  globalThis.fetch = savedFetch;
  process.chdir(savedCwd);
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(join(plainDir, ".."), { recursive: true, force: true });
});

afterEach(() => vi.restoreAllMocks());

/** Run `linear <path> <args> --json` and return what stdout carried, parsed. */
async function runJson(path: string, args: string[], drive: Drive): Promise<unknown> {
  process.chdir(drive.git ? gitDir : plainDir);
  setOverrides(drive.overrides ?? {});
  const argv = args.map((a) => (a === "FILE" ? join(plainDir, "shot.png") : a));
  let out = "";
  const spyOut = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
    out += c;
    return true;
  });
  const spyErr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    await createProgram().parseAsync(["node", "linear", ...path.split(" "), ...argv, "--json"]);
  } finally {
    spyOut.mockRestore();
    spyErr.mockRestore();
    setOverrides({});
  }
  expect(out.trim(), `${path}: nothing on stdout`).not.toBe("");
  return JSON.parse(out);
}

/**
 * Every way `value` disagrees with `shape`, for a list checking each row.
 * Strict about nullable relations: the omni client answers every one, so a
 * relation that is still null was not selected by the query or not mapped —
 * a `?? null` in a mapper would otherwise hide a dropped selection (TES-652).
 * `nullOk` names the keys a drive legitimately leaves null.
 */
function drift(value: unknown, shape: OutputShape, nullOk: string[] = []): string[] {
  const fields = shape.fields ?? {};
  const keep = (p: string) =>
    !nullOk.some((k) => p.endsWith(`.${k}: null, although the source answers every relation`));
  if (shape.kind === "list") {
    if (!Array.isArray(value)) return ["expected a bare array"];
    if (value.length === 0) return ["the fake produced no rows, so nothing was checked"];
    return value.flatMap((row, i) => matchesShape(row, fields, `$[${i}]`, true)).filter(keep);
  }
  return matchesShape(value, fields, "$", true).filter(keep);
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

const paths = walkCommands(createProgram()).map((n) => n.path);

describe("OUTPUT_SHAPES covers the program", () => {
  it("has an entry for every command path (a new command must declare its output)", () => {
    const missing = paths.filter((p) => !(p in OUTPUT_SHAPES));
    expect(missing, "add these to src/lib/output-shapes.ts").toEqual([]);
  });

  it("has no entry for a command that does not exist", () => {
    const stale = Object.keys(OUTPUT_SHAPES).filter((p) => !paths.includes(p));
    expect(stale).toEqual([]);
  });

  it("every JSON-printing command is driven by the sweep, or says why not", () => {
    const undriven = paths.filter((p) => OUTPUT_SHAPES[p] && !(p in DRIVES));
    expect(undriven, "add these to DRIVES (or a skip with a reason)").toEqual([]);
    for (const [p, d] of Object.entries(DRIVES)) {
      expect(OUTPUT_SHAPES[p], `${p} is driven but declares no output`).toBeTruthy();
      if (OUTPUT_SHAPES[p]!.kind === "raw" || OUTPUT_SHAPES[p]!.kind === "none") {
        expect(d.skip, `${p} is ${OUTPUT_SHAPES[p]!.kind} and must be skipped`).toBeTruthy();
      }
    }
  });

  it("list/object/receipt shapes all carry fields; raw/none carry none", () => {
    for (const [p, s] of Object.entries(OUTPUT_SHAPES)) {
      if (!s) continue;
      const withFields = s.kind === "list" || s.kind === "object" || s.kind === "receipt";
      expect(!!s.fields, `${p}: ${s.kind} ${withFields ? "needs" : "must not have"} fields`).toBe(
        withFields,
      );
      for (const [when, v] of Object.entries(s.variants ?? {})) {
        expect(!!v.fields, `${p} with ${when}: needs fields`).toBe(true);
      }
    }
  });
});

describe("`commands --json` describes itself", () => {
  it("every node matches COMMAND_NODE_SHAPE", () => {
    const nodes = walkCommands(createProgram());
    const problems = nodes.flatMap((n) => matchesShape(n, COMMAND_NODE_SHAPE, `$[${n.path}]`));
    expect(problems).toEqual([]);
  });
});

describe("what each command prints under --json matches its declared shape", () => {
  for (const [path, drive] of Object.entries(DRIVES)) {
    const declared = OUTPUT_SHAPES[path];
    if (!declared || drive.skip) continue;

    it(`${path}${drive.args.length ? " " + drive.args.join(" ") : ""}`, async () => {
      const value = await runJson(path, drive.args, drive);
      expect(drift(value, declared, drive.nullOk)).toEqual([]);
    });

    for (const [when, variant] of Object.entries(declared.variants ?? {})) {
      const argv = drive.variants?.[when];
      it(`${path} with ${when}`, async () => {
        expect(argv, `${path}: no drive for variant ${when}`).toBeDefined();
        if (argv![0]?.startsWith("SKIP:")) return;
        const value = await runJson(path, argv!, drive);
        expect(drift(value, variant, drive.nullOk)).toEqual([]);
      });
    }
  }
});
