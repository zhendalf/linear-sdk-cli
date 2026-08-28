import { afterAll, beforeAll, describe, expect, it, vi } from "bun:test";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";
import { connection, okPayload, payload } from "../unit/_fakes.js";

const UUID = "01234567-89ab-cdef-0123-456789abcdef";
const DATE = new Date("2026-08-28T10:00:00.000Z");

function customView(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID,
    name: "Urgent",
    modelName: "Issue",
    shared: true,
    slugId: "urgent-abc",
    updatedAt: DATE,
    createdAt: DATE,
    archivedAt: null,
    description: "Important work",
    filterData: { priority: { eq: 1 } },
    projectFilterData: null,
    initiativeFilterData: null,
    feedItemFilterData: null,
    color: null,
    icon: null,
    owner: Promise.resolve({ id: "u1", displayName: "Owner" }),
    creator: Promise.resolve({ id: "u2", displayName: "Creator" }),
    team: Promise.resolve({ id: "t1", key: "ENG", name: "Engineering" }),
    ...overrides,
  };
}

let client: any;
let clientDescriptor: PropertyDescriptor | undefined;
let savedKey: string | undefined;

beforeAll(() => {
  savedKey = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = "lin_api_test000000000000";
  clientDescriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
  Object.defineProperty(Context.prototype, "client", {
    configurable: true,
    get: () => client,
  });
});

afterAll(() => {
  if (clientDescriptor) Object.defineProperty(Context.prototype, "client", clientDescriptor);
  if (savedKey === undefined) delete process.env.LINEAR_API_KEY;
  else process.env.LINEAR_API_KEY = savedKey;
});

async function run(args: string[]): Promise<{ stdout: string; stderr: string }> {
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

describe("custom-view CLI contract", () => {
  it("is discoverable from root and command-level help", () => {
    const program = createProgram();
    expect(program.helpInformation()).toContain("custom-view|cv");
    const group = program.commands.find((command) => command.name() === "custom-view")!;
    const help = group.helpInformation();
    for (const command of ["list", "view", "results", "create", "update", "delete"]) {
      expect(help).toContain(command);
    }
    expect(
      group.commands.find((command) => command.name() === "view")!.helpInformation(),
    ).toContain("UUID");
  });

  it("renders a readable human list", async () => {
    client = {
      customViews: vi.fn(async () => connection([customView()])),
    };
    const { stdout, stderr } = await run(["custom-view", "list"]);
    expect(stdout).toContain("Name");
    expect(stdout).toContain("Urgent");
    expect(stdout).toContain("issue");
    expect(stdout).toContain("Owner");
    expect(stdout).toContain("ENG Engineering");
    expect(stderr).toBe("");
  });

  it("keeps JSON list output stable and pagination diagnostics on stderr", async () => {
    client = {
      customViews: vi.fn(async () =>
        connection([customView(), customView({ id: "11234567-89ab-cdef-0123-456789abcdef" })]),
      ),
    };
    const { stdout, stderr } = await run([
      "custom-view",
      "list",
      "--limit",
      "1",
      "--fields",
      "id,name,type",
      "--json",
    ]);
    expect(JSON.parse(stdout)).toEqual([{ id: UUID, name: "Urgent", type: "issue" }]);
    expect(stderr).toContain("Showing 1 results; more exist");
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it("emits one stable matched-entity shape for issue results", async () => {
    const model = customView({
      issues: vi.fn(async () =>
        connection([
          {
            id: "i1",
            identifier: "ENG-1",
            title: "Fix it",
            url: "https://linear.app/i1",
          },
        ]),
      ),
    });
    client = { customView: vi.fn(async () => model) };
    const { stdout, stderr } = await run(["custom-view", "results", UUID, "--json"]);
    expect(JSON.parse(stdout)).toEqual([
      {
        type: "issue",
        id: "i1",
        identifier: "ENG-1",
        name: "Fix it",
        url: "https://linear.app/i1",
      },
    ]);
    expect(stderr).toBe("");
  });

  it("parses create filters and emits only the JSON receipt on stdout", async () => {
    const created = customView({ shared: false });
    client = {
      createCustomView: vi.fn(async () => payload("customView", created)),
    };
    const { stdout, stderr } = await run([
      "custom-view",
      "create",
      "--name",
      "Urgent",
      "--type",
      "issue",
      "--filter",
      '{"priority":{"eq":1}}',
      "--personal",
      "--json",
    ]);
    expect(client.createCustomView).toHaveBeenCalledWith({
      name: "Urgent",
      filterData: { priority: { eq: 1 } },
      shared: false,
    });
    expect(JSON.parse(stdout)).toEqual({
      id: UUID,
      name: "Urgent",
      type: "issue",
      shared: false,
      slugId: "urgent-abc",
    });
    expect(stderr).toBe("");
  });

  it("requires an explicit type when create cannot prompt", async () => {
    client = { createCustomView: vi.fn() };
    await expect(
      run(["custom-view", "create", "--name", "x", "--no-input", "--json"]),
    ).rejects.toMatchObject({ code: "usage", exitCode: 2 });
    expect(client.createCustomView).not.toHaveBeenCalled();
  });

  it("refuses non-interactive deletion without --yes before calling delete", async () => {
    client = {
      customView: vi.fn(async () => customView()),
      deleteCustomView: vi.fn(),
    };
    await expect(
      run(["custom-view", "delete", UUID, "--no-input", "--json"]),
    ).rejects.toMatchObject({ code: "usage", exitCode: 2 });
    expect(client.deleteCustomView).not.toHaveBeenCalled();
  });

  it("deletes with --yes and returns a machine receipt", async () => {
    client = {
      customView: vi.fn(async () => customView()),
      deleteCustomView: vi.fn(async () => okPayload()),
    };
    const { stdout, stderr } = await run(["custom-view", "delete", UUID, "--yes", "--json"]);
    expect(JSON.parse(stdout)).toEqual({ id: UUID, name: "Urgent", deleted: true });
    expect(stderr).toBe("");
    expect(client.deleteCustomView).toHaveBeenCalledWith(UUID);
  });
});
