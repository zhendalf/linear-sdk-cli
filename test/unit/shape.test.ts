/**
 * The output-shape vocabulary (TES-610): `ShapeOf<T>` binds a declared shape
 * to the interface it describes at compile time, and `matchesShape` holds a
 * real value against a shape at run time. Together they are what keeps
 * `linear commands --json` from lying about a row's keys.
 */
import { describe, it, expect } from "bun:test";
import { shape, matchesShape, renderShape, renderOutputShape } from "../../src/lib/shape.js";

interface Row {
  id: string;
  n: number;
  ok: boolean;
  maybe: string | null;
  when: Date;
  rel: { name: string; type: string } | null;
  tags: string[];
  items: Array<{ id: string; score: number | null }>;
  bag: Record<string, unknown>;
  any: any;
  opt?: string;
  optNull: string | null | undefined;
}

const ROW = shape<Row>({
  id: "string",
  n: "number",
  ok: "boolean",
  maybe: "string|null",
  when: "string",
  rel: { nullable: { name: "string", type: "string" } },
  tags: ["string"],
  items: [{ id: "string", score: "number|null" }],
  bag: "object",
  any: "unknown",
  "opt?": "string",
  "optNull?": "string|null",
});

describe("ShapeOf<T> (compile-time drift guard)", () => {
  it("rejects a renamed, missing, re-typed, de-nulled or de-optionalised field", () => {
    // Each of these is a type error; the test's job is to keep them one
    // (`tsc` fails on an unused @ts-expect-error).
    // @ts-expect-error a key the interface does not have
    shape<Row>({ ...ROW, identifier: "string" });
    // @ts-expect-error wrong scalar type
    shape<Row>({ ...ROW, n: "string" });
    // @ts-expect-error nullability dropped
    shape<Row>({ ...ROW, rel: { name: "string", type: "string" } });
    // @ts-expect-error array element re-typed
    shape<Row>({ ...ROW, tags: ["number"] });
    // @ts-expect-error an optional key spelled as always-present
    shape<Row>({ ...ROW, opt: "string" });
    const { id: _id, ...missing } = ROW;
    // @ts-expect-error a field left out
    shape<Row>(missing);
    expect(ROW.id).toBe("string");
  });
});

describe("matchesShape (runtime)", () => {
  const value = {
    id: "a",
    n: 1,
    ok: true,
    maybe: null,
    when: "2026-01-01T00:00:00.000Z",
    rel: { name: "x", type: "y" },
    tags: ["t"],
    items: [{ id: "i", score: null }],
    bag: { anything: 1 },
    any: [1, 2],
  };

  it("accepts a conforming value, with the optional keys absent", () => {
    expect(matchesShape(value, ROW)).toEqual([]);
    expect(matchesShape({ ...value, opt: "x", optNull: null }, ROW)).toEqual([]);
  });

  it("names every drift by path: missing, extra, re-typed, unexpectedly null", () => {
    const bad = { ...value, id: 3, extra: 1, rel: null, tags: ["a", 2], items: [{ id: "i" }], opt: 1 } as any;
    delete bad.n;
    expect(matchesShape(bad, ROW)).toEqual([
      "$.id: expected string, got number",
      "$.n: expected number, got undefined",
      "$.tags[1]: expected string, got number",
      // A key whose type allows null is still a drift when it is MISSING:
      // the documented key would not be in the JSON at all.
      "$.items[0].score: expected number|null, got undefined",
      "$.opt: expected string, got number",
      "$.extra: not in the declared shape",
    ]);
  });

  it("a nullable object key that is absent is a drift; present-and-null is fine", () => {
    const { rel: _rel, ...noRel } = value;
    expect(matchesShape(noRel, ROW)).toEqual(["$.rel: expected an object or null, got undefined"]);
    expect(matchesShape({ ...value, rel: null }, ROW)).toEqual([]);
  });

  it("checks the wrapped shape once a nullable is present, and arrays item by item", () => {
    expect(matchesShape({ ...value, rel: { name: "x" } }, ROW)).toEqual([
      "$.rel.type: expected string, got undefined",
    ]);
    expect(matchesShape({ ...value, tags: "t" }, ROW)).toEqual(["$.tags: expected an array, got string"]);
    expect(matchesShape({ ...value, bag: [] }, ROW)).toEqual(["$.bag: expected an object, got an array"]);
  });

  it("a nullable object at the top level: null passes, a scalar does not", () => {
    const s = { nullable: { id: "string" } } as const;
    expect(matchesShape(null, s)).toEqual([]);
    expect(matchesShape("x", s)).toEqual(["$: expected an object, got string"]);
  });
});

describe("renderShape / renderOutputShape (human)", () => {
  it("prints TypeScript-ish one-liners", () => {
    expect(renderShape(ROW)).toBe(
      "{id: string, n: number, ok: boolean, maybe: string | null, when: string, " +
        "rel: {name: string, type: string} | null, tags: string[], " +
        "items: Array<{id: string, score: number | null}>, bag: object, any: unknown, " +
        "opt?: string, optNull?: string | null}",
    );
    expect(renderShape(["string|null"])).toBe("Array<string | null>");
  });

  it("heads a list with 'array of objects' and lists one field per line", () => {
    expect(renderOutputShape({ kind: "list", fields: { id: "string", rel: ROW.rel }, note: "n" })).toEqual([
      "array of objects:",
      "  id: string",
      "  rel: {name: string, type: string} | null",
      "  (n)",
    ]);
    expect(renderOutputShape({ kind: "raw" })).toEqual(["raw JSON (keys depend on the request)"]);
    expect(renderOutputShape({ kind: "none" })).toEqual(["none (never prints JSON)"]);
  });
});
