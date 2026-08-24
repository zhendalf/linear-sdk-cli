/**
 * Documents: the six attachment targets on create / list / update (TES-613),
 * and the mutation/detail plumbing. Every wire shape is pinned: the one `…Id`
 * field a target sets, the one relation clause it filters by.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";
import {
  createDocument,
  updateDocument,
  deleteDocument,
  getDocumentDetail,
  listDocuments,
  selectTarget,
  describeTarget,
} from "../../src/services/document.js";
import { connection } from "./_fakes.js";
import { CliError } from "../../src/lib/errors.js";

const UUID = "01234567-89ab-cdef-0123-456789abcdef";
const TEAM_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const CYCLE_ID = "cccccccc-0000-0000-0000-000000000001";
const RELEASE_ID = "eeeeeeee-0000-0000-0000-000000000001";
const INIT_ID = "11111111-0000-0000-0000-000000000001";

/** A client that can resolve every kind of target by name, and records writes. */
function fakeClient(sent: { creates: any[]; updates: any[]; raw: any[] }) {
  const team = {
    id: TEAM_ID,
    key: "TES",
    name: "Test",
    activeCycle: Promise.resolve({ id: CYCLE_ID, number: 4 }),
    cycles: async () => connection([{ id: CYCLE_ID, number: 4, name: "Sprint 4" }]),
  };
  return {
    teams: async () => connection([{ id: TEAM_ID, key: "TES", name: "Test" }]),
    team: async () => team,
    projects: async () => connection([{ id: "proj-1", name: "Roadmap" }]),
    issues: async () => connection([{ id: "issue-1", identifier: "TES-1" }]),
    initiatives: async () => connection([{ id: INIT_ID, name: "Platform" }]),
    initiative: async (id: string) => ({ id, name: "Platform" }),
    releases: async (args: any) => {
      sent.raw.push({ releases: args });
      return connection([{ id: RELEASE_ID, name: "Spring", version: "1.2.0" }]);
    },
    document: async (id: string) => ({ id, title: "Doc" }),
    createDocument: async (input: any) => {
      sent.creates.push(input);
      return {
        success: true,
        document: Promise.resolve({ id: "d1", title: input.title, url: "u" }),
      };
    },
    updateDocument: async (id: string, input: any) => {
      sent.updates.push({ id, input });
      return { success: true, document: Promise.resolve({ id, title: "Doc", url: "u" }) };
    },
    client: {
      rawRequest: async (query: string, vars: any) => {
        sent.raw.push({ query, vars });
        if (/CliDocumentDetail/.test(query)) return { data: { document: DETAIL_NODE } };
        return { data: { documents: { nodes: [], pageInfo: { hasNextPage: false } } } };
      },
    },
  } as any;
}

const DETAIL_NODE = {
  id: UUID,
  title: "Design",
  content: "# hi",
  url: "https://linear.app/x",
  slugId: "abc",
  icon: null,
  color: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  creator: { id: "u1", displayName: "Ada" },
  project: null,
  issue: { id: "issue-1", identifier: "TES-1" },
  initiative: null,
  team: null,
  cycle: null,
  release: null,
};

let sent: { creates: any[]; updates: any[]; raw: any[] };
beforeEach(() => {
  sent = { creates: [], updates: [], raw: [] };
});

describe("selectTarget — the six flags, before any request", () => {
  it("none → undefined", () => {
    expect(selectTarget({})).toBeUndefined();
  });

  it("each flag alone selects its kind", () => {
    expect(selectTarget({ project: "p" })).toEqual({ kind: "project", value: "p" });
    expect(selectTarget({ issue: "TES-1" })).toEqual({ kind: "issue", value: "TES-1" });
    expect(selectTarget({ initiative: "i" })).toEqual({ kind: "initiative", value: "i" });
    expect(selectTarget({ team: "TES" })).toEqual({ kind: "team", value: "TES" });
    expect(selectTarget({ release: "1.0" })).toEqual({ kind: "release", value: "1.0" });
  });

  it("--team with --cycle scopes the cycle; it is not a second target", () => {
    expect(selectTarget({ team: "TES", cycle: "current" })).toEqual({
      kind: "cycle",
      value: "current",
      team: "TES",
    });
  });

  it("two targets is a usage error naming both flags", () => {
    expect(() => selectTarget({ project: "p", issue: "TES-1" })).toThrow(/--project and --issue/);
    expect(() => selectTarget({ team: "TES", release: "1.0" })).toThrow(/--team and --release/);
    expect(() => selectTarget({ cycle: "1", initiative: "i" })).toThrow(/--initiative and --cycle/);
  });
});

describe("createDocument — one target, resolved to its one input id", () => {
  it("requires a target, naming all six flags", async () => {
    await expect(createDocument(fakeClient(sent), { title: "Spec" })).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(
        /--project, --issue, --initiative, --team, --cycle, or --release/,
      ),
    });
    expect(sent.creates).toEqual([]);
  });

  it("--project <name> → projectId", async () => {
    await createDocument(fakeClient(sent), { title: "T", project: "Roadmap" });
    expect(sent.creates[0]).toEqual({ title: "T", projectId: "proj-1" });
  });

  it("--issue <identifier> → issueId", async () => {
    await createDocument(fakeClient(sent), { title: "T", issue: "TES-1" });
    expect(sent.creates[0]).toEqual({ title: "T", issueId: "issue-1" });
  });

  it("--initiative <name> → initiativeId", async () => {
    await createDocument(fakeClient(sent), { title: "T", initiative: "Platform" });
    expect(sent.creates[0]).toEqual({ title: "T", initiativeId: INIT_ID });
  });

  it("--team <key> → teamId", async () => {
    await createDocument(fakeClient(sent), { title: "T", team: "TES" });
    expect(sent.creates[0]).toEqual({ title: "T", teamId: TEAM_ID });
  });

  it("--cycle current (team from --team) → cycleId, and no teamId", async () => {
    await createDocument(fakeClient(sent), { title: "T", team: "TES", cycle: "current" });
    expect(sent.creates[0]).toEqual({ title: "T", cycleId: CYCLE_ID });
  });

  it("--cycle without --team uses the configured team; without either it is a usage error", async () => {
    await createDocument(fakeClient(sent), { title: "T", cycle: "current" }, "TES");
    expect(sent.creates[0]).toEqual({ title: "T", cycleId: CYCLE_ID });
    await expect(
      createDocument(fakeClient(sent), { title: "T", cycle: "current" }),
    ).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/--cycle needs a team/),
    });
  });

  it("--release <name|version> → releaseId, matched server-side by name or version", async () => {
    await createDocument(fakeClient(sent), { title: "T", release: "1.2.0" });
    expect(sent.creates[0]).toEqual({ title: "T", releaseId: RELEASE_ID });
    expect(sent.raw[0].releases.filter).toEqual({
      or: [{ name: { eqIgnoreCase: "1.2.0" } }, { version: { eq: "1.2.0" } }],
    });
  });

  it("a uuid for any target is sent as-is", async () => {
    await createDocument(fakeClient(sent), { title: "T", release: UUID });
    expect(sent.creates[0]).toEqual({ title: "T", releaseId: UUID });
    expect(sent.raw).toEqual([]);
  });

  it("includes content when provided (including empty string)", async () => {
    await createDocument(fakeClient(sent), { title: "T", content: "", project: UUID });
    expect(sent.creates[0]).toEqual({ title: "T", content: "", projectId: UUID });
  });

  it("two targets: usage error, no request", async () => {
    await expect(
      createDocument(fakeClient(sent), { title: "T", project: UUID, issue: "TES-1" }),
    ).rejects.toMatchObject({ code: "usage" });
    expect(sent.creates).toEqual([]);
  });

  it("fails when the payload carries no document", async () => {
    const client = {
      createDocument: async () => ({ success: true, document: Promise.resolve(null) }),
    } as any;
    await expect(createDocument(client, { title: "T", project: UUID })).rejects.toMatchObject({
      code: "api",
      exitCode: 1,
    });
  });
});

describe("updateDocument — metadata, and re-pointing", () => {
  it("nothing to update is a usage error that mentions the targets", async () => {
    await expect(updateDocument(fakeClient(sent), UUID, {})).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/--title, --content, or a new target/),
    });
  });

  it("sends only the fields provided", async () => {
    await updateDocument(fakeClient(sent), UUID, { title: "New" });
    expect(sent.updates).toEqual([{ id: UUID, input: { title: "New" } }]);
  });

  it("--issue re-points: the one issueId, nothing else", async () => {
    await updateDocument(fakeClient(sent), UUID, { issue: "TES-1" });
    expect(sent.updates).toEqual([{ id: UUID, input: { issueId: "issue-1" } }]);
  });

  it("--project + --title in one update", async () => {
    await updateDocument(fakeClient(sent), UUID, { title: "T", project: "Roadmap" });
    expect(sent.updates[0].input).toEqual({ title: "T", projectId: "proj-1" });
  });

  it("re-point to a cycle uses the configured team when --team is absent", async () => {
    await updateDocument(fakeClient(sent), UUID, { cycle: "4" }, "TES");
    expect(sent.updates[0].input).toEqual({ cycleId: CYCLE_ID });
  });

  it("two targets: usage error before the document lookup", async () => {
    let looked = false;
    const client = fakeClient(sent);
    client.document = async () => {
      looked = true;
      return { id: UUID };
    };
    await expect(updateDocument(client, UUID, { team: "TES", project: "p" })).rejects.toMatchObject(
      {
        code: "usage",
      },
    );
    expect(looked).toBe(false);
  });
});

describe("listDocuments — the one relation clause per target", () => {
  it("sends no filter when unfiltered", async () => {
    await listDocuments(fakeClient(sent), 50);
    expect(sent.raw[0].vars.filter).toBeUndefined();
  });

  it("resolves a human reference to an id for each kind", async () => {
    const cases: Array<[Record<string, string>, Record<string, unknown>]> = [
      [{ project: "Roadmap" }, { project: { id: { eq: "proj-1" } } }],
      [{ issue: "TES-1" }, { issue: { id: { eq: "issue-1" } } }],
      [{ initiative: "Platform" }, { initiative: { id: { eq: INIT_ID } } }],
      [{ team: "TES" }, { team: { id: { eq: TEAM_ID } } }],
      [{ team: "TES", cycle: "current" }, { cycle: { id: { eq: CYCLE_ID } } }],
      [{ release: "Spring" }, { release: { id: { eq: RELEASE_ID } } }],
    ];
    for (const [flags, expected] of cases) {
      sent = { creates: [], updates: [], raw: [] };
      await listDocuments(fakeClient(sent), 50, flags);
      const page = sent.raw.find((r) => r.vars);
      expect(page.vars.filter).toEqual(expected);
    }
  });

  it("two filters could never match — usage error, no request", async () => {
    await expect(
      listDocuments(fakeClient(sent), 50, { project: "p", issue: "TES-1" }),
    ).rejects.toMatchObject({
      code: "usage",
    });
    expect(sent.raw).toEqual([]);
  });

  it("the query selects all six targets, and rows carry them as objects (absent ones null)", async () => {
    const client = fakeClient(sent);
    client.client.rawRequest = async (query: string) => {
      sent.raw.push({ query });
      return {
        data: {
          documents: {
            nodes: [
              {
                id: "d1",
                title: "A",
                url: "u",
                updatedAt: "2026-01-01T00:00:00.000Z",
                project: null,
                issue: null,
                initiative: null,
                team: { id: TEAM_ID, key: "TES", name: "Test" },
                cycle: null,
                release: null,
              },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      };
    };
    const rows = await listDocuments(client, 50);
    expect(sent.raw[0].query).toMatch(
      /project \{ id name \}[\s\S]*issue \{ id identifier \}[\s\S]*initiative \{ id name \}[\s\S]*team \{ id key name \}[\s\S]*cycle \{ id number name \}[\s\S]*release \{ id name version \}/,
    );
    expect(rows[0]).toEqual({
      id: "d1",
      title: "A",
      url: "u",
      updatedAt: "2026-01-01T00:00:00.000Z",
      project: null,
      issue: null,
      initiative: null,
      team: { id: TEAM_ID, key: "TES", name: "Test" },
      cycle: null,
      release: null,
    });
    expect(describeTarget(rows[0]!)).toBe("Team: TES Test");
  });
});

describe("describeTarget", () => {
  const none = {
    project: null,
    issue: null,
    initiative: null,
    team: null,
    cycle: null,
    release: null,
  };
  it("names the target with its kind", () => {
    expect(describeTarget({ ...none, project: { id: "p", name: "Roadmap" } })).toBe(
      "Project: Roadmap",
    );
    expect(describeTarget({ ...none, issue: { id: "i", identifier: "TES-1" } })).toBe(
      "Issue: TES-1",
    );
    expect(describeTarget({ ...none, initiative: { id: "i", name: "Platform" } })).toBe(
      "Initiative: Platform",
    );
    expect(describeTarget({ ...none, cycle: { id: "c", number: 4, name: "Sprint 4" } })).toBe(
      "Cycle: #4 Sprint 4",
    );
    expect(describeTarget({ ...none, cycle: { id: "c", number: 4, name: null } })).toBe(
      "Cycle: #4",
    );
    expect(
      describeTarget({ ...none, release: { id: "r", name: "Spring", version: "1.2.0" } }),
    ).toBe("Release: Spring (1.2.0)");
    expect(describeTarget(none)).toBeNull();
  });
});

describe("getDocumentDetail / deleteDocument", () => {
  it("one tailored request; relations are objects with ids, absent ones null", async () => {
    const detail = await getDocumentDetail(fakeClient(sent), UUID);
    expect(sent.raw).toHaveLength(1);
    expect(sent.raw[0].vars).toEqual({ id: UUID });
    expect(detail).toMatchObject({
      id: UUID,
      title: "Design",
      content: "# hi",
      creator: { id: "u1", displayName: "Ada" },
      issue: { id: "issue-1", identifier: "TES-1" },
      project: null,
      team: null,
    });
    expect(describeTarget(detail)).toBe("Issue: TES-1");
  });

  it("a slugId is passed straight to document(id:), which accepts both", async () => {
    await getDocumentDetail(fakeClient(sent), "my-doc-abc123");
    expect(sent.raw[0].vars).toEqual({ id: "my-doc-abc123" });
  });

  it("a null document is not-found", async () => {
    const client = fakeClient(sent);
    client.client.rawRequest = async () => ({ data: { document: null } });
    await expect(getDocumentDetail(client, UUID)).rejects.toMatchObject({ code: "not_found" });
  });

  it("deletes by id and returns the resolved document", async () => {
    const deleteDocumentMock = vi.fn().mockResolvedValue({ success: true });
    const client = {
      document: vi.fn().mockResolvedValue({ id: UUID, title: "Gone" }),
      deleteDocument: deleteDocumentMock,
    } as any;
    const doc = await deleteDocument(client, UUID);
    expect(deleteDocumentMock).toHaveBeenCalledWith(UUID);
    expect(doc.id).toBe(UUID);
  });

  it("preserves auth/network failures while resolving a slug for deletion", async () => {
    const client = {
      document: vi.fn().mockRejectedValue(new CliError("offline", "network")),
      deleteDocument: vi.fn(),
    } as any;
    await expect(deleteDocument(client, "design-doc")).rejects.toMatchObject({
      code: "network",
      message: "offline",
    });
    expect(client.deleteDocument).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Command level: how the global --team and the configured team play in.
// ---------------------------------------------------------------------------
describe("`document` commands — --team vs the configured team", () => {
  let root: string;
  let savedCwd: string;
  let savedEnv: Record<string, string | undefined>;
  let clientDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "lindoc-")));
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
    process.env.LINEAR_TEAM = "TES"; // the configured team
    clientDescriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
    Object.defineProperty(Context.prototype, "client", {
      get: () => fakeClient(sent),
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

  async function run(args: string[]): Promise<void> {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await createProgram().parseAsync(["node", "linear", ...args, "--json"]);
    } finally {
      spy.mockRestore();
    }
  }

  it("create with no target flag: the configured team is the target", async () => {
    await run(["document", "create", "--title", "T"]);
    expect(sent.creates[0]).toEqual({ title: "T", teamId: TEAM_ID });
  });

  it("create --project with a configured team: the project, and no second target", async () => {
    await run(["document", "create", "--title", "T", "--project", "Roadmap"]);
    expect(sent.creates[0]).toEqual({ title: "T", projectId: "proj-1" });
  });

  it("create --team ENG --project P: two explicit targets is a usage error", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let err: any;
    try {
      await run(["document", "create", "--title", "T", "--team", "TES", "--project", "Roadmap"]);
    } catch (e) {
      err = e;
    } finally {
      spy.mockRestore();
    }
    expect(err).toMatchObject({ code: "usage" });
  });

  it("list: the configured team does NOT filter; an explicit --team does, in either position", async () => {
    await run(["document", "list"]);
    expect(sent.raw[0].vars.filter).toBeUndefined();
    sent = { creates: [], updates: [], raw: [] };
    await run(["document", "list", "--team", "TES"]);
    expect(sent.raw.find((r) => r.vars)!.vars.filter).toEqual({ team: { id: { eq: TEAM_ID } } });
    sent = { creates: [], updates: [], raw: [] };
    await run(["--team", "TES", "document", "list"]);
    expect(sent.raw.find((r) => r.vars)!.vars.filter).toEqual({ team: { id: { eq: TEAM_ID } } });
  });

  it("update --title with a configured team does not re-point the document", async () => {
    await run(["document", "update", UUID, "--title", "New"]);
    expect(sent.updates).toEqual([{ id: UUID, input: { title: "New" } }]);
  });

  it("update --team re-points; --cycle uses the configured team to look the cycle up", async () => {
    await run(["document", "update", UUID, "--team", "TES"]);
    expect(sent.updates[0].input).toEqual({ teamId: TEAM_ID });
    sent = { creates: [], updates: [], raw: [] };
    await run(["document", "update", UUID, "--cycle", "current"]);
    expect(sent.updates[0].input).toEqual({ cycleId: CYCLE_ID });
  });
});
