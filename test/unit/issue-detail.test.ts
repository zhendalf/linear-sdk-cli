import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";
import { getIssueDetail, listIssues } from "../../src/services/issue.js";
import { renderIssueDetail } from "../../src/commands/issue.js";
import { Output } from "../../src/output/format.js";

const UUID = "7e83b04e-5618-401f-9151-bb3c2b511fe6";

/** A live issue node as the tailored detail query returns it. */
const node = {
  id: UUID,
  identifier: "TES-601",
  title: "Parity: everything",
  description: "body",
  priority: 2,
  priorityLabel: "High",
  estimate: 3,
  url: "https://linear.app/x/issue/TES-601",
  branchName: "eb/tes-601-parity",
  dueDate: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
  archivedAt: null,
  trashed: null,
  startedAt: "2026-08-02T00:00:00.000Z",
  completedAt: null,
  canceledAt: null,
  state: { id: "st-1", name: "In Progress", type: "started" },
  assignee: { id: "u-1", displayName: "ada", email: "ada@x.io" },
  team: { id: "team-1", key: "TES", name: "Test workspace" },
  project: { id: "p-1", name: "linear-sdk-cli" },
  projectMilestone: { id: "m-1", name: "Parity" },
  cycle: { id: "c-1", number: 3, name: null },
  parent: { id: "i-0", identifier: "TES-600" },
  labels: { nodes: [{ id: "l-1", name: "parity" }, { id: "l-2", name: "Bug" }] },
  subscribers: { nodes: [{ id: "u-1", displayName: "ada" }] },
};

function stub(nodes: any[], calls: Array<{ query: string; vars: any }> = []) {
  return {
    client: {
      rawRequest: async (query: string, vars: any) => {
        calls.push({ query, vars });
        return { data: { issues: { nodes } } };
      },
    },
  } as any;
}

/**
 * TES-622: `issue view` resolved the issue and then awaited nine lazy SDK
 * getters (state, assignee, team, project, milestone, cycle, parent, labels,
 * subscribers), each its own request — 8 for TES-601, measured live. One
 * tailored query now selects all of it.
 */
describe("getIssueDetail — one round-trip", () => {
  it("is exactly ONE request, with every relation selected in the query", async () => {
    const calls: Array<{ query: string; vars: any }> = [];
    await getIssueDetail(stub([node], calls), "TES-601");
    expect(calls).toHaveLength(1);
    const { query } = calls[0]!;
    expect(query).toContain("issues(filter: $filter, first: 1, includeArchived: true)");
    for (const sel of [
      "state { id name type }",
      "assignee { id displayName email }",
      "team { id key name }",
      "project { id name }",
      "projectMilestone { id name }",
      "cycle { id number name }",
      "parent { id identifier }",
      "labels(first: 50) { nodes { id name } }",
      "subscribers(first: 50) { nodes { id displayName } }",
      "archivedAt trashed startedAt completedAt canceledAt",
    ]) {
      expect(query).toContain(sel);
    }
  });

  it("an identifier filters by team key + number (uppercased), never by issue(id:)", async () => {
    const calls: Array<{ query: string; vars: any }> = [];
    await getIssueDetail(stub([node], calls), "tes-601");
    expect(calls[0]!.vars).toEqual({
      filter: { team: { key: { eq: "TES" } }, number: { eq: 601 } },
    });
  });

  it("a UUID filters by id", async () => {
    const calls: Array<{ query: string; vars: any }> = [];
    await getIssueDetail(stub([node], calls), UUID);
    expect(calls[0]!.vars).toEqual({ filter: { id: { eq: UUID } } });
  });

  it("an empty page is not_found, naming the issue as the user would", async () => {
    await expect(getIssueDetail(stub([]), "tes-9999")).rejects.toMatchObject({
      code: "not_found",
      message: "No issue TES-9999.",
    });
  });

  it("something that is neither an identifier nor a UUID is a usage error, before any request", async () => {
    const calls: Array<{ query: string; vars: any }> = [];
    await expect(getIssueDetail(stub([node], calls), "not-an-id-1x")).rejects.toMatchObject({
      code: "usage",
    });
    expect(calls).toHaveLength(0);
  });
});

/**
 * TES-627: the detail JSON flattened every relation into a display string
 * (`team: "TES Test workspace"` — unparseable, team names contain spaces;
 * `assignee: "ada"` — no id) while the list rows carried objects. The detail
 * is now a superset of the row: `.state.name` reads the same on both, and the
 * ids a script needs to act are there.
 */
describe("getIssueDetail — structured relations", () => {
  it("returns relations as objects with ids, keeping every top-level key", async () => {
    const d = await getIssueDetail(stub([node]), "TES-601");
    expect(d.id).toBe(UUID);
    expect(d.state).toEqual({ id: "st-1", name: "In Progress", type: "started" });
    expect(d.assignee).toEqual({ id: "u-1", displayName: "ada", email: "ada@x.io" });
    expect(d.team).toEqual({ id: "team-1", key: "TES", name: "Test workspace" });
    expect(d.project).toEqual({ id: "p-1", name: "linear-sdk-cli" });
    expect(d.milestone).toEqual({ id: "m-1", name: "Parity" });
    expect(d.cycle).toEqual({ id: "c-1", number: 3, name: null });
    expect(d.parent).toEqual({ id: "i-0", identifier: "TES-600" });
    expect(d.labels).toEqual([
      { id: "l-1", name: "parity" },
      { id: "l-2", name: "Bug" },
    ]);
    expect(d.subscribers).toEqual([{ id: "u-1", displayName: "ada" }]);
    // The scalars, under the keys they always had.
    expect(d).toMatchObject({
      identifier: "TES-601",
      title: "Parity: everything",
      description: "body",
      priority: 2,
      priorityLabel: "High",
      estimate: 3,
      branchName: "eb/tes-601-parity",
      dueDate: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    });
  });

  it("nulls an absent relation and empties an absent list — no placeholders", async () => {
    const bare = {
      ...node,
      state: null,
      assignee: null,
      team: null,
      project: null,
      projectMilestone: null,
      cycle: null,
      parent: null,
      labels: { nodes: [] },
      subscribers: { nodes: [] },
      description: null,
      estimate: null,
    };
    const d = await getIssueDetail(stub([bare]), "TES-601");
    expect(d.state).toBeNull();
    expect(d.assignee).toBeNull();
    expect(d.team).toBeNull();
    expect(d.project).toBeNull();
    expect(d.milestone).toBeNull();
    expect(d.cycle).toBeNull();
    expect(d.parent).toBeNull();
    expect(d.labels).toEqual([]);
    expect(d.subscribers).toEqual([]);
    expect(d.description).toBeNull();
    expect(d.estimate).toBeNull();
  });
});

/**
 * TES-624: a deleted issue viewed exactly like a live one — `issue delete
 * TES-616` then `issue view TES-616 --json` showed `state: Backlog`, exit 0.
 * The lifecycle fields are on the detail and on every list row now.
 */
describe("archived / trashed (TES-624)", () => {
  it("a live issue: archivedAt null, trashed false (the API sends trashed: null)", async () => {
    const d = await getIssueDetail(stub([node]), "TES-601");
    expect(d.archivedAt).toBeNull();
    expect(d.trashed).toBe(false);
    expect(d.startedAt).toBe("2026-08-02T00:00:00.000Z");
    expect(d.completedAt).toBeNull();
    expect(d.canceledAt).toBeNull();
  });

  it("a trashed issue says so, with the time it went", async () => {
    const d = await getIssueDetail(
      stub([{ ...node, trashed: true, archivedAt: "2026-08-16T15:41:08.952Z" }]),
      "TES-601",
    );
    expect(d.trashed).toBe(true);
    expect(d.archivedAt).toBe("2026-08-16T15:41:08.952Z");
  });

  it("an archived (not trashed) issue: archivedAt set, trashed false", async () => {
    const d = await getIssueDetail(
      stub([{ ...node, trashed: null, archivedAt: "2026-08-10T00:00:00.000Z" }]),
      "TES-601",
    );
    expect(d.trashed).toBe(false);
    expect(d.archivedAt).toBe("2026-08-10T00:00:00.000Z");
  });

  it("list rows carry the same lifecycle fields, and the query asks for them", async () => {
    let sentQuery = "";
    const client = {
      client: {
        rawRequest: async (query: string) => {
          sentQuery = query;
          return {
            data: {
              issues: {
                nodes: [
                  {
                    ...node,
                    labels: { nodes: [{ name: "parity" }] },
                    trashed: true,
                    archivedAt: "2026-08-16T15:41:08.952Z",
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
            },
          };
        },
      },
    } as any;
    const rows = await listIssues(client, { includeArchived: true }, 50, undefined);
    expect(sentQuery).toContain("archivedAt trashed startedAt completedAt canceledAt");
    expect(rows[0]).toMatchObject({
      identifier: "TES-601",
      trashed: true,
      archivedAt: "2026-08-16T15:41:08.952Z",
      startedAt: "2026-08-02T00:00:00.000Z",
      completedAt: null,
      canceledAt: null,
    });
  });

  /**
   * TES-652: list rows selected project and labels but not projectMilestone or
   * cycle, so `issue list --json | jq 'group_by(.milestone.name)'` put every
   * issue in the null bucket while `issue view` showed the milestone.
   */
  it("list rows carry milestone and cycle in the detail's object shape, from the same query", async () => {
    let sentQuery = "";
    const client = {
      client: {
        rawRequest: async (query: string) => {
          sentQuery = query;
          return {
            data: {
              issues: {
                nodes: [
                  { ...node, labels: { nodes: [{ name: "parity" }] } },
                  { ...node, identifier: "TES-602", projectMilestone: null, cycle: null },
                ],
                pageInfo: { hasNextPage: false },
              },
            },
          };
        },
      },
    } as any;
    const rows = await listIssues(client, {}, 50, undefined);
    // Two fields on the one existing query — no extra request.
    expect(sentQuery).toContain("projectMilestone { id name }");
    expect(sentQuery).toContain("cycle { id number name }");
    expect(rows[0]!.milestone).toEqual({ id: "m-1", name: "Parity" });
    expect(rows[0]!.cycle).toEqual({ id: "c-1", number: 3, name: null });
    // Absent relations are null, not undefined, so the key is always present in JSON.
    expect(rows[1]!.milestone).toBeNull();
    expect(rows[1]!.cycle).toBeNull();
    expect(Object.keys(rows[1]!)).toEqual(expect.arrayContaining(["milestone", "cycle"]));
  });
});

/** The human `issue view`, rendered from the structured detail. */
describe("renderIssueDetail (human view)", () => {
  function render(detail: any, json = false): { out: string } {
    let out = "";
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
      out += c;
      return true;
    });
    const ctx = { output: new Output({ json, color: false, quiet: false, debug: false }), client: {} };
    return renderIssueDetail(ctx as any, detail, false)
      .finally(() => spy.mockRestore())
      .then(() => ({ out })) as any;
  }
  const detail = () => getIssueDetail(stub([node]), "TES-601");

  it("spells the relations as it always did: team `KEY name`, cycle `#n`, labels comma-joined", async () => {
    const { out } = await render(await detail());
    expect(out).toContain("State:       In Progress");
    expect(out).toContain("Assignee:    ada");
    expect(out).toContain("Team:        TES Test workspace");
    expect(out).toContain("Project:     linear-sdk-cli");
    expect(out).toContain("Milestone:   Parity");
    expect(out).toContain("Cycle:       #3");
    expect(out).toContain("Parent:      TES-600");
    expect(out).toContain("Labels:      parity, Bug");
    expect(out).not.toContain("Trashed");
    expect(out).not.toContain("Archived");
  });

  it("says TRASHED loudly, right under the title, for a deleted issue", async () => {
    const d = await getIssueDetail(stub([{ ...node, trashed: true, archivedAt: "2026-08-16T15:41:08.952Z" }]), "TES-601");
    const { out } = await render(d);
    const lines = out.split("\n");
    expect(lines[0]).toContain("TES-601");
    expect(lines[1]).toBe("Trashed:     YES (deleted 2026-08-16T15:41:08.952Z)");
    expect(out).not.toContain("Archived:");
  });

  it("says ARCHIVED for an archived-but-not-trashed issue", async () => {
    const d = await getIssueDetail(stub([{ ...node, archivedAt: "2026-08-10T00:00:00.000Z" }]), "TES-601");
    const { out } = await render(d);
    expect(out.split("\n")[1]).toBe("Archived:    YES (2026-08-10T00:00:00.000Z)");
  });

  it("--json is the structured detail itself: `.state.name` reads like a list row", async () => {
    const { out } = await render(await detail(), true);
    const parsed = JSON.parse(out);
    expect(parsed.state.name).toBe("In Progress");
    expect(parsed.team).toEqual({ id: "team-1", key: "TES", name: "Test workspace" });
    expect(parsed.id).toBe(UUID);
    expect(parsed.trashed).toBe(false);
  });
});

/**
 * TES-652: `milestone` and `cycle` are `--fields`-selectable columns on the
 * list table (not defaults — it is wide already). A cycle shows its name, or
 * `#n` when unnamed; the generic row-key fallback would have printed its id.
 */
describe("issue list --fields milestone,cycle (human table)", () => {
  let clientDescriptor: PropertyDescriptor | undefined;
  let savedKey: string | undefined;

  const listClient = () => ({
    client: {
      rawRequest: async () => ({
        data: {
          issues: {
            nodes: [
              { ...node, labels: { nodes: [] } },
              { ...node, identifier: "TES-602", projectMilestone: null, cycle: { id: "c-2", number: 4, name: "Sprint 4" } },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      }),
    },
  });

  beforeEach(() => {
    savedKey = process.env.LINEAR_API_KEY;
    process.env.LINEAR_API_KEY = "lin_api_test000000000000";
    clientDescriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
    Object.defineProperty(Context.prototype, "client", { get: () => listClient(), configurable: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (clientDescriptor) Object.defineProperty(Context.prototype, "client", clientDescriptor);
    if (savedKey === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = savedKey;
  });

  async function run(args: string[]): Promise<string> {
    let out = "";
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
      out += c;
      return true;
    });
    try {
      await createProgram().parseAsync(["node", "linear", ...args]);
    } finally {
      spy.mockRestore();
    }
    return out;
  }

  it("are not default columns, but --fields selects them by name with proper headers", async () => {
    const plain = await run(["issue", "list", "--no-ansi"]);
    expect(plain.split("\n")[0]).not.toContain("Milestone");
    const picked = await run(["issue", "list", "--fields", "id,milestone,cycle", "--no-ansi"]);
    const lines = picked.split("\n");
    expect(lines[0]!.replace(/\s+/g, " ").trim()).toBe("ID Milestone Cycle");
    expect(lines[1]!.replace(/\s+/g, " ").trim()).toBe("TES-601 Parity #3");
    expect(lines[2]!.replace(/\s+/g, " ").trim()).toBe("TES-602 — Sprint 4");
  });

  it("--json --fields milestone projects the object, not a display string", async () => {
    const out = await run(["issue", "list", "--fields", "identifier,milestone", "--json"]);
    expect(JSON.parse(out)).toEqual([
      { identifier: "TES-601", milestone: { id: "m-1", name: "Parity" } },
      { identifier: "TES-602", milestone: null },
    ]);
  });
});
