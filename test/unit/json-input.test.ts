import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJsonObjectInput } from "../../src/lib/json-input.js";

describe("parseJsonObjectInput", () => {
  it("parses an inline object without changing its values", () => {
    expect(
      parseJsonObjectInput({
        inline: '{"priority":{"lte":2,"neq":0},"or":[{"title":{"contains":"bug"}}]}',
        label: "filter",
      }),
    ).toEqual({
      priority: { lte: 2, neq: 0 },
      or: [{ title: { contains: "bug" } }],
    });
  });

  it("reads an object from a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "linear-json-input-"));
    try {
      const file = join(dir, "filter.json");
      writeFileSync(file, '{"state":{"type":{"eq":"started"}}}');
      expect(parseJsonObjectInput({ file, label: "filter" })).toEqual({
        state: { type: { eq: "started" } },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined when neither source was provided", () => {
    expect(parseJsonObjectInput({ label: "filter" })).toBeUndefined();
  });

  it("rejects two sources, invalid JSON, and non-object JSON", () => {
    expect(() => parseJsonObjectInput({ inline: "{}", file: "x", label: "filter" })).toThrow(
      /either --filter or --filter-file/,
    );
    expect(() => parseJsonObjectInput({ inline: "{", label: "filter" })).toThrow(/Invalid JSON/);
    for (const inline of ["null", "[]", '"text"', "42"]) {
      expect(() => parseJsonObjectInput({ inline, label: "filter" })).toThrow(
        /must be a JSON object/,
      );
    }
  });
});
