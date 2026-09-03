import { afterAll, beforeAll, describe, expect, it, vi } from "bun:test";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";

const PROJECTS = [
  { id: "p1", name: "Live", state: "started", url: "u1", archivedAt: null, trashed: null },
  {
    id: "p2",
    name: "Archived",
    state: "completed",
    url: "u2",
    archivedAt: "2026-01-01T00:00:00.000Z",
    trashed: false,
  },
  {
    id: "p3",
    name: "Trashed",
    state: "canceled",
    url: "u3",
    archivedAt: "2026-01-02T00:00:00.000Z",
    trashed: true,
  },
];

const INITIATIVES = [
  { id: "i1", name: "Live", status: "Active", url: "u1", archivedAt: null, trashed: null },
  {
    id: "i2",
    name: "Archived",
    status: "Completed",
    url: "u2",
    archivedAt: "2026-01-01T00:00:00.000Z",
    trashed: false,
  },
  {
    id: "i3",
    name: "Trashed",
    status: "Canceled",
    url: "u3",
    archivedAt: "2026-01-02T00:00:00.000Z",
    trashed: true,
  },
];

let calls: Array<{ query: string; variables: Record<string, any> }> = [];
let clientDescriptor: PropertyDescriptor | undefined;
let savedEnv: Record<string, string | undefined>;

/** Deliberately serve one row per page so --limit and --all exercise different paths. */
function page(items: any[], variables: Record<string, any>) {
  const offset = variables.after ? Number(String(variables.after).slice(1)) : 0;
  const nodes = items.slice(offset, offset + 1);
  const end = offset + nodes.length;
  return {
    nodes,
    pageInfo: {
      hasNextPage: end < items.length,
      endCursor: nodes.length ? `c${end}` : null,
    },
  };
}

beforeAll(() => {
  savedEnv = {
    LINEAR_API_KEY: process.env.LINEAR_API_KEY,
    LINEAR_TEAM: process.env.LINEAR_TEAM,
  };
  process.env.LINEAR_API_KEY = "lin_api_test000000000000";
  process.env.LINEAR_TEAM = "TES";
  clientDescriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
  Object.defineProperty(Context.prototype, "client", {
    configurable: true,
    get: () => ({
      client: {
        rawRequest: async (query: string, variables: Record<string, any>) => {
          calls.push({ query, variables });
          const source = query.includes("CliProjects") ? PROJECTS : INITIATIVES;
          const items = variables.includeArchived ? source : source.slice(0, 1);
          const key = query.includes("CliProjects") ? "projects" : "initiatives";
          return { data: { [key]: page(items, variables) } };
        },
      },
    }),
  });
});

afterAll(() => {
  if (clientDescriptor) Object.defineProperty(Context.prototype, "client", clientDescriptor);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function run(args: string[]): Promise<{ stdout: string; stderr: string }> {
  calls = [];
  let stdout = "";
  let stderr = "";
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    stdout += chunk;
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    stderr += chunk;
    return true;
  });
  try {
    await createProgram().parseAsync(["node", "linear", ...args]);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return { stdout, stderr };
}

describe("archived-resource listing contract", () => {
  it("defaults to live resources and sends includeArchived: false", async () => {
    const { stdout, stderr } = await run(["project", "list", "--json"]);
    expect(JSON.parse(stdout)).toEqual([
      expect.objectContaining({ name: "Live", archivedAt: null, trashed: false }),
    ]);
    expect(stderr).toBe("");
    expect(calls[0]!.variables.includeArchived).toBe(false);
  });

  it("combines inclusion, filtering, --all, --fields, and JSON-only stdout", async () => {
    const { stdout, stderr } = await run([
      "project",
      "list",
      "--state",
      "started",
      "--include-archived",
      "--all",
      "--fields",
      "name,archivedAt,trashed",
      "--json",
    ]);
    expect(JSON.parse(stdout)).toEqual(
      PROJECTS.map(({ name, archivedAt, trashed }) => ({
        name,
        archivedAt,
        trashed: trashed === true,
      })),
    );
    expect(stderr).toBe("");
    expect(calls).toHaveLength(3);
    expect(calls[0]!.variables).toMatchObject({
      includeArchived: true,
      filter: {
        accessibleTeams: { some: { key: { eq: "TES" } } },
        status: {
          or: [{ name: { eqIgnoreCase: "started" } }, { type: { eqIgnoreCase: "started" } }],
        },
      },
    });
  });

  it("keeps --limit independent and reports remaining historical rows on stderr", async () => {
    const { stdout, stderr } = await run([
      "project",
      "list",
      "--include-archived",
      "--limit",
      "2",
      "--json",
    ]);
    expect(JSON.parse(stdout)).toHaveLength(2);
    expect(stderr).toContain("Showing 2 results; more exist. Use --all");
    expect(calls).toHaveLength(2);
  });

  it("keeps initiative --archived as a compatibility alias of the canonical flag", async () => {
    const canonical = await run(["initiative", "list", "--include-archived", "--all", "--json"]);
    expect(JSON.parse(canonical.stdout)).toHaveLength(3);
    expect(calls[0]!.variables.includeArchived).toBe(true);

    const alias = await run(["initiative", "list", "--archived", "--all", "--json"]);
    expect(JSON.parse(alias.stdout)).toHaveLength(3);
    expect(calls[0]!.variables.includeArchived).toBe(true);

    await expect(
      run(["initiative", "list", "--include-archived", "--archived", "--json"]),
    ).rejects.toMatchObject({ code: "usage" });
  });

  it("marks archived and trashed resources differently in human tables", async () => {
    for (const command of ["project", "initiative"]) {
      const { stdout } = await run([command, "list", "--include-archived", "--all"]);
      expect(stdout).toContain("(archived)");
      expect(stdout).toContain("(trashed)");
    }
  });
});
