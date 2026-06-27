import { describe, it, expect } from "bun:test";
import { renderTable, renderDetail, selectColumns, type Column } from "../../src/output/table.js";
import { CliError } from "../../src/lib/errors.js";

interface Row {
  id: string;
  title: string;
}
const columns: Column<Row>[] = [
  { key: "id", value: (r) => r.id },
  { key: "title", header: "Title", value: (r) => r.title, max: 10 },
];

describe("renderTable", () => {
  it("renders aligned columns with headers", () => {
    const out = renderTable([{ id: "TES-1", title: "Hello" }], columns);
    const lines = out.split("\n");
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("Title");
    expect(lines[1]).toContain("TES-1");
    expect(lines[1]).toContain("Hello");
  });

  it("truncates over the column max with an ellipsis", () => {
    const out = renderTable([{ id: "X", title: "abcdefghijklmnop" }], columns);
    expect(out).toContain("abcdefghi…");
  });

  it("shows a placeholder for empty result sets", () => {
    expect(renderTable([], columns)).toBe("(no results)");
  });
});

describe("selectColumns", () => {
  it("filters and reorders by requested fields", () => {
    const picked = selectColumns(columns, ["title", "id"]);
    expect(picked.map((c) => c.key)).toEqual(["title", "id"]);
  });
  it("throws a usage error on an unknown field, listing available keys", () => {
    expect(() => selectColumns(columns, ["nope"])).toThrow(CliError);
    expect(() => selectColumns(columns, ["nope"])).toThrow(/Unknown field 'nope'\. Available: id, title\./);
  });
  it("matches by header (case-insensitive) as well as key", () => {
    expect(selectColumns(columns, ["TITLE"]).map((c) => c.key)).toEqual(["title"]);
  });
  it("returns all columns when no fields given", () => {
    expect(selectColumns(columns).length).toBe(2);
  });
});

describe("renderDetail", () => {
  it("renders key: value pairs and skips undefined", () => {
    const out = renderDetail([
      ["Name", "Ann"],
      ["Email", undefined],
      ["Admin", true],
    ]);
    expect(out).toContain("Name:");
    expect(out).toContain("Ann");
    expect(out).not.toContain("Email");
    expect(out).toContain("Admin:");
    expect(out).toContain("true");
  });
});
