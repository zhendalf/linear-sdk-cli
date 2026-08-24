/**
 * `issue create` — templates, the default template, a sub-issue's project, and
 * `--start` (TES-639). Service-level tests pin the exact IssueCreateInput sent;
 * command-level tests run the real program against a fake client.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";
import { createIssue, moveIssueState, startIssue } from "../../src/services/issue.js";
import { resolveTemplateId } from "../../src/lib/resolve.js";
import { connection, payload } from "./_fakes.js";

const TEAM_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER_TEAM_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const PARENT_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const PROJECT_ID = "cccccccc-0000-0000-0000-000000000001";
const TPL_TEAM = "dddddddd-0000-0000-0000-000000000001";
const TPL_SHARED = "dddddddd-0000-0000-0000-000000000002";
const TPL_OTHER_TEAM = "dddddddd-0000-0000-0000-000000000003";
const TPL_PROJECT_TYPE = "dddddddd-0000-0000-0000-000000000004";

const TEMPLATES = [
  { id: TPL_TEAM, name: "Bug", type: "issue", team: { id: TEAM_ID } },
  { id: TPL_SHARED, name: "Bug", type: "issue", team: null },
  { id: TPL_OTHER_TEAM, name: "Incident", type: "issue", team: { id: OTHER_TEAM_ID } },
  { id: TPL_PROJECT_TYPE, name: "Roadmap item", type: "project", team: null },
  { id: "dddddddd-0000-0000-0000-000000000005", name: "Feature", type: "issue", team: null },
];

/** What the fake client saw. */
let createInputs: any[];
let updateInputs: any[];
let rawQueries: string[];

function fakeClient(opts: { parentProject?: { id: string } | null } = {}) {
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
  const parent = {
    id: PARENT_ID,
    identifier: "TES-7",
    project: Promise.resolve(
      opts.parentProject === undefined ? { id: PROJECT_ID } : opts.parentProject,
    ),
    team: Promise.resolve(teamModel),
  };
  return {
    teams: async () => connection([{ id: TEAM_ID, key: "TES", name: "Test" }]),
    team: async (id: string) => (id === TEAM_ID ? teamModel : undefined),
    viewer: Promise.resolve({ id: "me-uuid" }),
    issues: async () => connection([parent]),
    projects: async () => connection([{ id: PROJECT_ID, name: "Explicit" }]),
    createIssue: async (input: any) => {
      createInputs.push(input);
      return payload("issue", {
        id: "new-issue-uuid",
        identifier: "TES-99",
        url: "https://linear.app/t/issue/TES-99",
        branchName: "tes-99-new",
        team: Promise.resolve(teamModel),
      });
    },
    updateIssue: async (_id: string, input: any) => {
      updateInputs.push(input);
      return payload("issue", { id: "new-issue-uuid", identifier: "TES-99" });
    },
    client: {
      rawRequest: async (query: string) => {
        rawQueries.push(query);
        return { data: { templates: TEMPLATES } };
      },
    },
  } as any;
}

beforeEach(() => {
  createInputs = [];
  updateInputs = [];
  rawQueries = [];
});

describe("createIssue — templates (TES-639)", () => {
  it("asks for the team's default template by default: the API applies it only when told to", async () => {
    await createIssue(fakeClient(), { title: "t", team: "TES" }, undefined);
    expect(createInputs[0]).toEqual({ teamId: TEAM_ID, title: "t", useDefaultTemplate: true });
  });

  it("useDefaultTemplate: false (--no-default-template) leaves the flag out entirely", async () => {
    await createIssue(
      fakeClient(),
      { title: "t", team: "TES", useDefaultTemplate: false },
      undefined,
    );
    expect(createInputs[0]).toEqual({ teamId: TEAM_ID, title: "t" });
    expect("useDefaultTemplate" in createInputs[0]).toBe(false);
  });

  it("--template <name> resolves to templateId and drops useDefaultTemplate (an explicit template wins)", async () => {
    await createIssue(fakeClient(), { title: "t", team: "TES", template: "Feature" }, undefined);
    expect(createInputs[0]).toEqual({
      teamId: TEAM_ID,
      title: "t",
      templateId: "dddddddd-0000-0000-0000-000000000005",
    });
    // One request, and it is the plain `templates` list (no args in the schema).
    expect(rawQueries).toHaveLength(1);
    expect(rawQueries[0]).toMatch(/templates \{ id name type team \{ id \} \}/);
  });

  it("--template <uuid> is sent as-is, no lookup", async () => {
    await createIssue(fakeClient(), { title: "t", team: "TES", template: TPL_SHARED }, undefined);
    expect(createInputs[0].templateId).toBe(TPL_SHARED);
    expect(rawQueries).toHaveLength(0);
  });
});

describe("resolveTemplateId — scope and preference", () => {
  it("prefers the team's own template over a shared one of the same name", async () => {
    expect(await resolveTemplateId(fakeClient(), TEAM_ID, "bug")).toBe(TPL_TEAM);
  });

  it("finds a shared (team-less) template from any team", async () => {
    expect(await resolveTemplateId(fakeClient(), OTHER_TEAM_ID, "Feature")).toBe(
      "dddddddd-0000-0000-0000-000000000005",
    );
  });

  it("does not see another team's template, and says which are available", async () => {
    await expect(resolveTemplateId(fakeClient(), TEAM_ID, "Incident")).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringMatching(
        /No issue template 'Incident'.*Available: Bug, Bug, Feature\./,
      ),
    });
  });

  it("ignores templates of other types (a project template is not an issue template)", async () => {
    await expect(resolveTemplateId(fakeClient(), TEAM_ID, "Roadmap item")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("createIssue — a sub-issue joins its parent's project (TES-639)", () => {
  it("--parent alone: projectId is the parent's project", async () => {
    await createIssue(fakeClient(), { title: "t", team: "TES", parent: "TES-7" }, undefined);
    expect(createInputs[0]).toMatchObject({ parentId: PARENT_ID, projectId: PROJECT_ID });
  });

  it("--parent with --project: the explicit project wins", async () => {
    const other = "cccccccc-0000-0000-0000-000000000009";
    await createIssue(
      fakeClient(),
      { title: "t", team: "TES", parent: "TES-7", project: other },
      undefined,
    );
    expect(createInputs[0]).toMatchObject({ parentId: PARENT_ID, projectId: other });
  });

  it("a parent outside any project: no projectId at all", async () => {
    await createIssue(
      fakeClient({ parentProject: null }),
      { title: "t", team: "TES", parent: "TES-7" },
      undefined,
    );
    expect(createInputs[0].parentId).toBe(PARENT_ID);
    expect("projectId" in createInputs[0]).toBe(false);
  });

  it("--milestone can name one in the inherited project", async () => {
    const client = fakeClient();
    client.project = async () => ({
      projectMilestones: async () => connection([{ id: "ms-1", name: "Alpha" }]),
    });
    await createIssue(
      client,
      { title: "t", team: "TES", parent: "TES-7", milestone: "Alpha" },
      undefined,
    );
    expect(createInputs[0]).toMatchObject({ projectId: PROJECT_ID, projectMilestoneId: "ms-1" });
  });

  it("--milestone with neither --project nor a parent in a project is a usage error", async () => {
    await expect(
      createIssue(
        fakeClient({ parentProject: null }),
        { title: "t", team: "TES", parent: "TES-7", milestone: "Alpha" },
        undefined,
      ),
    ).rejects.toMatchObject({ code: "usage" });
  });
});

describe("moveIssueState / startIssue", () => {
  const issue = {
    id: "issue-1",
    team: Promise.resolve({ id: TEAM_ID }),
  } as any;

  it("move: the team's lowest-position `started` state, one updateIssue", async () => {
    await moveIssueState(fakeClient(), issue, { move: true });
    expect(updateInputs).toEqual([{ stateId: "state-started-1" }]);
  });

  it("an explicit state name wins over `move`", async () => {
    await moveIssueState(fakeClient(), issue, { move: true, stateInput: "In Review" });
    expect(updateInputs).toEqual([{ stateId: "state-started-2" }]);
  });

  it("neither: no request", async () => {
    await moveIssueState(fakeClient(), issue, {});
    expect(updateInputs).toEqual([]);
  });

  it("startIssue resolves the id and then moves (unchanged contract)", async () => {
    const result = await startIssue(fakeClient(), "TES-7", { move: true });
    expect(result.identifier).toBe("TES-7");
    expect(updateInputs).toEqual([{ stateId: "state-started-1" }]);
  });
});

// ---------------------------------------------------------------------------
// Command level: `linear issue create …` through the real program.
// ---------------------------------------------------------------------------
describe("`issue create` command — flags (TES-639)", () => {
  let root: string;
  let savedCwd: string;
  let savedEnv: Record<string, string | undefined>;
  let clientDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    // A scratch directory that is NOT a git repository, so `--start` reports
    // the branch name instead of checking anything out.
    root = realpathSync(mkdtempSync(join(tmpdir(), "lincreate-")));
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

  async function runJson(args: string[]): Promise<any> {
    let out = "";
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
      out += c;
      return true;
    });
    try {
      await createProgram().parseAsync(["node", "linear", ...args, "--json"]);
    } finally {
      spy.mockRestore();
    }
    return JSON.parse(out);
  }

  it("--no-default-template and the reference's --no-use-default-template both drop the flag", async () => {
    await runJson(["issue", "create", "--title", "t", "--no-default-template"]);
    expect("useDefaultTemplate" in createInputs[0]).toBe(false);
    await runJson(["issue", "create", "--title", "t", "--no-use-default-template"]);
    expect("useDefaultTemplate" in createInputs[1]).toBe(false);
    await runJson(["issue", "create", "--title", "t"]);
    expect(createInputs[2].useDefaultTemplate).toBe(true);
  });

  it("--start: assigns to you, creates, moves to the first started state, reports the branch", async () => {
    const out = await runJson(["issue", "create", "--title", "t", "--start"]);
    expect(createInputs[0]).toMatchObject({ title: "t", assigneeId: "me-uuid" });
    expect(updateInputs).toEqual([{ stateId: "state-started-1" }]);
    expect(out).toEqual({
      id: "new-issue-uuid",
      identifier: "TES-99",
      url: "https://linear.app/t/issue/TES-99",
      branch: "tes-99-new",
      checkedOut: false,
      stateChanged: true,
    });
  });

  it("--start --state X: created in X, no second move", async () => {
    const out = await runJson([
      "issue",
      "create",
      "--title",
      "t",
      "--start",
      "--state",
      "In Review",
    ]);
    expect(createInputs[0].stateId).toBe("state-started-2");
    expect(updateInputs).toEqual([]);
    expect(out.stateChanged).toBe(false);
  });

  it("--start with somebody else as --assignee is a usage error, before any request", async () => {
    let err: any;
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await createProgram().parseAsync([
        "node",
        "linear",
        "issue",
        "create",
        "--title",
        "t",
        "--start",
        "--assignee",
        "ada@example.com",
        "--json",
      ]);
    } catch (e) {
      err = e;
    } finally {
      spy.mockRestore();
    }
    expect(err).toMatchObject({ code: "usage" });
    expect(createInputs).toEqual([]);
  });

  it("--start --assignee me is fine (that is what --start means)", async () => {
    await runJson(["issue", "create", "--title", "t", "--start", "--assignee", "me"]);
    expect(createInputs[0].assigneeId).toBe("me-uuid");
  });

  it("without --start the JSON is unchanged: id, identifier, url", async () => {
    const out = await runJson(["issue", "create", "--title", "t"]);
    expect(out).toEqual({
      id: "new-issue-uuid",
      identifier: "TES-99",
      url: "https://linear.app/t/issue/TES-99",
    });
  });
});
