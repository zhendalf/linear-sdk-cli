import { describe, it, expect } from "bun:test";
import { renderTable, renderDetail, selectColumns, selectPairs, projectFields, cell, type Column } from "../../src/output/table.js";
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

/**
 * TES-635 (1): `--fields` was inconsistent — validated only in human list mode
 * (`--fields nope --json` exited 0 with every key, `--fields nope` exited 2),
 * ignored on detail views, and able to pick only among the table's default
 * columns although the row carried more (`labels`, `project`, `url`, …). It is
 * one projection now: columns or any row key for the table, labelled lines for
 * the detail block, top-level keys under --json — validated everywhere.
 */
describe("--fields as a projection", () => {
  interface Full {
    id: string;
    title: string;
    labels: string[];
    project: { name: string } | null;
    url: string;
  }
  const cols: Column<Full>[] = [
    { key: "id", header: "ID", value: (r) => r.id },
    { key: "title", header: "Title", value: (r) => r.title },
  ];
  const row: Full = { id: "TES-1", title: "T", labels: ["a", "b"], project: { name: "Auth" }, url: "u" };

  it("selectColumns: a row key that is not a column becomes one, rendering arrays and objects readably", () => {
    const picked = selectColumns(cols, ["id", "labels", "project"], row);
    expect(picked.map((c) => c.key)).toEqual(["id", "labels", "project"]);
    const out = renderTable([row], picked);
    expect(out.split("\n")[0]).toBe("ID     labels  project");
    expect(out.split("\n")[1]).toBe("TES-1  a, b    Auth");
  });

  it("selectColumns: unknown → usage error listing columns and the extra row keys", () => {
    expect(() => selectColumns(cols, ["nope"], row)).toThrow(
      /Unknown field 'nope'\. Available: id, title; also any row key: labels, project, url\./,
    );
  });

  it("projectFields (--json): keeps the named keys in order, on a list and on a single object", () => {
    expect(projectFields<unknown>([row], ["title", "id"])).toEqual([{ title: "T", id: "TES-1" }]);
    expect(projectFields<unknown>(row, ["url"])).toEqual({ url: "u" });
    expect(projectFields([row], undefined)).toEqual([row]);
  });

  it("projectFields: an unknown key is a usage error naming the real ones; an empty list is fine", () => {
    expect(() => projectFields([row], ["nope"])).toThrow(CliError);
    expect(() => projectFields([row], ["nope"])).toThrow(/Available: id, title, labels, project, url\./);
    expect(projectFields([], ["nope"])).toEqual([]);
  });

  it("selectPairs (human detail): matches labels case-insensitively, in the order asked", () => {
    const pairs: Array<[string, unknown]> = [["Issue", "TES-1"], ["State", "Done"], ["URL", "u"]];
    expect(selectPairs(pairs, ["url", "state"])).toEqual([["URL", "u"], ["State", "Done"]]);
    expect(() => selectPairs(pairs, ["nope"])).toThrow(/Unknown field 'nope'\. Available: Issue, State, URL\./);
  });

  it("cell renders a relation object by its human name, and an unknown object as JSON", () => {
    expect(cell({ id: "x", name: "Auth" })).toBe("Auth");
    expect(cell({ displayName: "ada" })).toBe("ada");
    expect(cell({ identifier: "TES-1" })).toBe("TES-1");
    expect(cell({ foo: 1 })).toBe('{"foo":1}');
    expect(cell([{ name: "a" }, { name: "b" }])).toBe("a, b");
  });
});
