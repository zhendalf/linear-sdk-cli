import { afterAll, beforeAll, describe, expect, it, vi } from "bun:test";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";

const UUID = "01234567-89ab-cdef-0123-456789abcdef";
const PROJECT = {
  id: UUID,
  identifier: "P-TES-123",
  name: "Authentication",
  url: "https://linear.app/test/project/authentication",
  priority: 0,
  priorityLabel: "No priority",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let clientDescriptor: PropertyDescriptor | undefined;
let apiKey: string | undefined;
let calls: Array<{ query: string; variables: any }> = [];

beforeAll(() => {
  apiKey = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = "lin_api_test000000000000";
  clientDescriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
  Object.defineProperty(Context.prototype, "client", {
    configurable: true,
    get: () => ({
      client: {
        rawRequest: async (query: string, variables: any) => {
          calls.push({ query, variables });
          if (query.includes("CliProjectReferenceDetail")) {
            return { data: { project: PROJECT } };
          }
          return {
            data: {
              projects: {
                nodes: query.includes("CliProjectDetail")
                  ? []
                  : [PROJECT, { ...PROJECT, id: "legacy", identifier: null }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          };
        },
      },
    }),
  });
});

afterAll(() => {
  if (clientDescriptor) Object.defineProperty(Context.prototype, "client", clientDescriptor);
  if (apiKey === undefined) delete process.env.LINEAR_API_KEY;
  else process.env.LINEAR_API_KEY = apiKey;
});

async function run(args: string[]) {
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
    await createProgram().parseAsync(["node", "linear", ...args, "--json"]);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return { result: JSON.parse(stdout), stderr };
}

describe("project identifier output contract", () => {
  it("views a canonical identifier with JSON-only stdout and selectable identifier", async () => {
    const { result, stderr } = await run([
      "project",
      "view",
      "P-TES-123",
      "--fields",
      "id,identifier,name",
    ]);
    expect(result).toEqual({ id: UUID, identifier: "P-TES-123", name: "Authentication" });
    expect(stderr).toBe("");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.variables).toEqual({ id: "P-TES-123" });
  });

  it("lists identifiers and preserves an explicit null when absent", async () => {
    const { result, stderr } = await run([
      "project",
      "list",
      "--all-teams",
      "--fields",
      "id,identifier",
    ]);
    expect(result).toEqual([
      { id: UUID, identifier: "P-TES-123" },
      { id: "legacy", identifier: null },
    ]);
    expect(stderr).toBe("");
    expect(calls[0]!.query).toContain("id identifier name");
  });

  it.each(["list", "view"])("advertises identifier in project %s discovery", async (command) => {
    const { result, stderr } = await run(["commands", "project", command]);
    expect(result.output.fields.identifier).toBe("string|null");
    if (command === "view") expect(result.description).toContain("identifier, name, or UUID");
    expect(stderr).toBe("");
  });
});
