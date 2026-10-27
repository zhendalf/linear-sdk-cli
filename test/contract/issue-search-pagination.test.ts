import { afterAll, beforeAll, describe, expect, it, vi } from "bun:test";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";
import { normalizeError } from "../../src/lib/errors.js";
import { Output } from "../../src/output/format.js";

type Page = { ids: string[]; hasNextPage: boolean; cursor?: string };
let pages: Page[] = [];
let calls: Record<string, any>[] = [];
let descriptor: PropertyDescriptor | undefined;
let savedKey: string | undefined;

beforeAll(() => {
  savedKey = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = "lin_api_test000000000000";
  descriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
  Object.defineProperty(Context.prototype, "client", {
    configurable: true,
    get: () => ({
      client: {
        rawRequest: async (query: string, variables: Record<string, any>) => {
          expect(query).toContain("query CliSearchIssues");
          calls.push(variables);
          const page = pages[calls.length - 1];
          if (!page) throw new Error("Unexpected extra search request");
          return {
            data: {
              searchIssues: {
                nodes: page.ids.map((id) => ({ id, identifier: `TES-${id}`, title: "Match" })),
                pageInfo: { hasNextPage: page.hasNextPage, endCursor: page.cursor },
              },
            },
          };
        },
      },
    }),
  });
});

afterAll(() => {
  if (descriptor) Object.defineProperty(Context.prototype, "client", descriptor);
  if (savedKey === undefined) delete process.env.LINEAR_API_KEY;
  else process.env.LINEAR_API_KEY = savedKey;
});

async function run(source: Page[], args: string[]) {
  pages = source;
  calls = [];
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    stdout += chunk;
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    stderr += chunk;
    return true;
  });
  try {
    await createProgram().parseAsync([
      "node",
      "linear",
      "issue",
      "search",
      "match",
      "--team",
      "TES",
      "--fields",
      "id",
      "--json",
      ...args,
    ]);
  } catch (error) {
    const normalized = normalizeError(error);
    exitCode = normalized.exitCode;
    new Output({ json: true, color: false, quiet: false, debug: false }).error(normalized);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return { stdout, stderr, exitCode };
}

describe("issue search pagination contract", () => {
  it("prints each issue once and avoids a false truncation warning", async () => {
    const result = await run(
      [
        { ids: ["1", "1"], hasNextPage: true, cursor: "a" },
        { ids: ["1", "2", "2"], hasNextPage: false },
      ],
      ["--limit", "2"],
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([{ id: "1" }, { id: "2" }]);
    expect(result.stderr).toBe("");
    expect(calls.map((variables) => variables.after)).toEqual([undefined, "a"]);
  });

  it("reports more only after observing another unique issue", async () => {
    const result = await run([{ ids: ["1", "1", "2", "3"], hasNextPage: false }], ["--limit", "2"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([{ id: "1" }, { id: "2" }]);
    expect(result.stderr).toContain("Showing 2 results; more exist");
  });

  it("fails bounded and unbounded repeated pages with one JSON error and no partial stdout", async () => {
    for (const args of [["--limit", "6"], ["--all"]]) {
      const result = await run(
        [
          { ids: ["1", "2"], hasNextPage: true, cursor: "a" },
          { ids: ["1", "2"], hasNextPage: true, cursor: "b" },
        ],
        args,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error).toMatchObject({
        code: "api",
        suggestion: expect.stringContaining("do not increase --limit"),
        details: { connection: "searchIssues", reason: "no_new_results", uniqueResults: 2 },
      });
      expect(result.stderr).not.toContain("more exist");
      expect(calls).toHaveLength(2);
    }
  });
});
