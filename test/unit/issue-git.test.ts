/**
 * The git-facing issue commands, through the real program against a fake
 * client: `issue start` (TES-637 item 4) and `issue describe` (item 5).
 * `issue pull-request` shells out to `gh`; its title/body come from
 * `buildPrContent`, pinned in git.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";
import { connection } from "./_fakes.js";

const TEAM_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const URL = "https://linear.app/acme/issue/TES-7/fix-login";

let updateInputs: any[];
let suggestedBranch: string;
let branchAtMutation: string | undefined;

function fakeClient() {
  const teamModel = {
    id: TEAM_ID,
    key: "TES",
    name: "Test",
    states: async () =>
      connection([
        { id: "state-started-2", name: "In Review", type: "started", position: 2 },
        { id: "state-started-1", name: "In Progress", type: "started", position: 1 },
        { id: "state-backlog", name: "Backlog", type: "backlog", position: 0 },
      ]),
  };
  const issue = {
    id: "issue-7",
    identifier: "TES-7",
    title: "Fix login",
    url: URL,
    branchName: suggestedBranch,
    team: Promise.resolve(teamModel),
  };
  return {
    team: async (id: string) => (id === TEAM_ID ? teamModel : undefined),
    issues: async () => connection([issue]),
    updateIssue: async (_id: string, input: any) => {
      updateInputs.push(input);
      try {
        branchAtMutation = execFileSync("git", ["branch", "--show-current"], {
          encoding: "utf8",
        }).trim();
      } catch {
        branchAtMutation = undefined;
      }
      return { success: true, issue: Promise.resolve(issue) };
    },
    client: {
      rawRequest: async () => ({
        data: {
          issues: {
            nodes: [
              {
                id: "issue-7",
                identifier: "TES-7",
                title: "Fix login",
                description: "internal notes",
                priority: 0,
                priorityLabel: "No priority",
                url: URL,
                branchName: "ada/tes-7-fix-login",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                labels: { nodes: [] },
                team: { id: TEAM_ID, key: "TES", name: "Test" },
              },
            ],
          },
        },
      }),
    },
  } as any;
}

let root: string;
let savedCwd: string;
let savedEnv: Record<string, string | undefined>;
let clientDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  // A scratch directory that is NOT a git repository, so `start` reports the
  // branch name instead of checking anything out.
  root = realpathSync(mkdtempSync(join(tmpdir(), "lingit-")));
  savedCwd = process.cwd();
  process.chdir(root);
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
  updateInputs = [];
  suggestedBranch = "ada/tes-7-fix-login";
  branchAtMutation = undefined;
  clientDescriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
  Object.defineProperty(Context.prototype, "client", {
    get: () => fakeClient(),
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (clientDescriptor) Object.defineProperty(Context.prototype, "client", clientDescriptor);
  process.chdir(savedCwd);
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true });
});

/** Run through the real program; hand back stdout (and parsed JSON when `--json` was passed). */
async function run(args: string[]): Promise<{ out: string; json: any; err: string }> {
  let out = "";
  let err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => ((out += c), true));
  const e = vi.spyOn(process.stderr, "write").mockImplementation((c: any) => ((err += c), true));
  try {
    await createProgram().parseAsync(["node", "linear", ...args]);
  } finally {
    o.mockRestore();
    e.mockRestore();
  }
  return { out, json: args.includes("--json") ? JSON.parse(out) : undefined, err };
}

/**
 * schpet/linear-cli's `issue start` always moves the issue to the first
 * `started` state after branching (T `src/utils/actions.ts:82-109`); ours only
 * did with `--move`, so the transplanted command left the issue in Backlog and
 * said nothing. Moving is the default now; `--no-move` opts out; `--move` is
 * still accepted so an existing script keeps working.
 */
describe("`issue start` moves to the first 'started' state by default (TES-637 #4)", () => {
  it("bare `start`: one updateIssue to the lowest-position started state, reported in the JSON", async () => {
    const { json } = await run(["issue", "start", "TES-7", "--json"]);
    expect(updateInputs).toEqual([{ stateId: "state-started-1" }]);
    expect(json).toEqual({
      id: "issue-7",
      identifier: "TES-7",
      branch: "ada/tes-7-fix-login",
      checkedOut: false,
      stateChanged: true,
    });
  });

  it("--no-move: no request, stateChanged false", async () => {
    const { json } = await run(["issue", "start", "TES-7", "--no-move", "--json"]);
    expect(updateInputs).toEqual([]);
    expect(json.stateChanged).toBe(false);
  });

  it("accepts a bare numeric reference by expanding the configured team", async () => {
    const { json } = await run(["issue", "start", "7", "--no-checkout", "--json"]);
    expect(json.identifier).toBe("TES-7");
    expect(updateInputs).toHaveLength(1);
  });

  it("--move is still accepted (hidden), and means what the default means", async () => {
    await run(["issue", "start", "TES-7", "--move", "--json"]);
    expect(updateInputs).toEqual([{ stateId: "state-started-1" }]);
    const start = createProgram()
      .commands.find((c) => c.name() === "issue")!
      .commands.find((c) => c.name() === "start")!;
    expect(start.helpInformation()).toContain("--no-move");
    expect(start.helpInformation()).not.toMatch(/^\s+--move\b/m);
  });

  it("--state X moves to X (as before); --state with --no-move is a usage error, before any request", async () => {
    await run(["issue", "start", "TES-7", "--state", "In Review", "--json"]);
    expect(updateInputs).toEqual([{ stateId: "state-started-2" }]);
    updateInputs = [];
    await expect(
      run(["issue", "start", "TES-7", "--state", "In Review", "--no-move", "--json"]),
    ).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/either --state or --no-move/),
    });
    expect(updateInputs).toEqual([]);
  });

  it("the human output says both what it did to git and to the state", async () => {
    const { err } = await run(["issue", "start", "TES-7"]);
    // Not a git repo: the branch is only named; the move is announced.
    expect(err).toContain("Moved TES-7 → started");
  });

  it("checks out the branch before mutating Linear", async () => {
    execFileSync("git", ["init", "-q"]);
    execFileSync("git", ["checkout", "-q", "-b", "main"]);
    const { json } = await run(["issue", "start", "TES-7", "--json"]);
    expect(branchAtMutation).toBe("ada/tes-7-fix-login");
    expect(json).toMatchObject({ checkedOut: true, stateChanged: true });
  });

  it("surfaces git stderr and performs no Linear mutation when checkout fails", async () => {
    execFileSync("git", ["init", "-q"]);
    execFileSync("git", ["checkout", "-q", "-b", "main"]);
    suggestedBranch = "bad..branch";

    await expect(run(["issue", "start", "TES-7", "--json"])).rejects.toMatchObject({
      code: "runtime",
      message: expect.stringMatching(/not a valid branch name/i),
    });
    expect(updateInputs).toEqual([]);
  });
});

/**
 * schpet prints `ID Title\n\nLinear-issue: Fixes ID\nLinear-issue-url: URL`
 * (T `src/utils/jj.ts:11-18`); ours printed `Title\n\nFixes ID`. Piped into
 * `git commit -m`, that was a different commit from the same command.
 */
describe("`issue describe` prints schpet's commit message (TES-637 #5)", () => {
  it("human: `ID Title`, blank line, the two trailers — and nothing else on stdout", async () => {
    const { out } = await run(["issue", "describe", "TES-7"]);
    expect(out).toBe(`TES-7 Fix login\n\nLinear-issue: Fixes TES-7\nLinear-issue-url: ${URL}\n`);
  });

  it("-r/--references: `Linear-issue: References ID`", async () => {
    const { out } = await run(["issue", "describe", "TES-7", "-r"]);
    expect(out).toBe(
      `TES-7 Fix login\n\nLinear-issue: References TES-7\nLinear-issue-url: ${URL}\n`,
    );
  });

  it("--json: the parts, plus the whole message as printed", async () => {
    const { json } = await run(["issue", "describe", "TES-7", "--json"]);
    expect(json).toEqual({
      identifier: "TES-7",
      title: "Fix login",
      url: URL,
      trailer: "Fixes TES-7",
      message: `TES-7 Fix login\n\nLinear-issue: Fixes TES-7\nLinear-issue-url: ${URL}`,
    });
  });
});
