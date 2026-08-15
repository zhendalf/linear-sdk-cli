import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSchema, introspectionFromSchema } from "graphql";
import { runSchema } from "../../src/commands/discover.js";
import { Output } from "../../src/output/format.js";

// A miniature schema stands in for Linear's, so the SDL path is exercised for
// real (buildClientSchema + printSchema) without a network round trip.
const INTROSPECTION = introspectionFromSchema(
  buildSchema(`
    type Query { viewer: User }
    type User { id: ID!, displayName: String }
  `),
);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "linschema-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function harness(json: boolean) {
  const ctx = {
    client: { client: { rawRequest: vi.fn().mockResolvedValue({ data: INTROSPECTION }) } },
    output: new Output({ json, color: false, quiet: true, debug: false }),
  } as any;
  return ctx;
}

/** Capture stdout while the action runs. */
async function capture(fn: () => Promise<void>): Promise<string> {
  let out = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
    out += c;
    return true;
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return out;
}

describe("schema: format and destination are independent", () => {
  it("--json -o <file> writes the introspection JSON to the file", async () => {
    const file = join(dir, "introspection.json");
    const out = await capture(() => runSchema(harness(true), { output: file }));

    // The bug: the JSON branch returned before the write, so the file never
    // appeared and the payload went to stdout instead.
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    expect(parsed.__schema.queryType.name).toBe("Query");
    expect(out).toBe("");
  });

  it("-o <file> alone writes SDL to the file", async () => {
    const file = join(dir, "schema.graphql");
    const out = await capture(() => runSchema(harness(false), { output: file }));

    const sdl = readFileSync(file, "utf8");
    expect(sdl).toContain("type User");
    expect(sdl).toContain("displayName: String");
    expect(sdl).not.toContain("__schema");
    expect(out).toBe("");
  });

  it("--json without -o still prints introspection JSON to stdout", async () => {
    const out = await capture(() => runSchema(harness(true), {}));
    expect(JSON.parse(out).__schema.queryType.name).toBe("Query");
  });

  it("no flags prints SDL to stdout", async () => {
    const out = await capture(() => runSchema(harness(false), {}));
    expect(out).toContain("type User");
    expect(out).not.toContain("__schema");
  });

  it("reports an unwritable destination instead of throwing a raw fs error", async () => {
    const file = join(dir, "no-such-dir", "schema.graphql");
    await expect(runSchema(harness(false), { output: file })).rejects.toThrow(
      /Cannot write to '.*schema\.graphql'/,
    );
  });
});
