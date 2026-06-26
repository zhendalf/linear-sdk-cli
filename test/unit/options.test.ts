import { describe, it, expect } from "bun:test";
import { collectKeyVal, collectArray, parseList, parseIntOption } from "../../src/lib/options.js";
import { CliError } from "../../src/lib/errors.js";

describe("collectKeyVal", () => {
  it("accumulates key=value pairs", () => {
    const acc = collectKeyVal("a=1", {});
    expect(collectKeyVal("b=2", acc)).toEqual({ a: "1", b: "2" });
  });
  it("supports '=' in the value", () => {
    expect(collectKeyVal("token=ab=cd", {})).toEqual({ token: "ab=cd" });
  });
  it("throws on missing '='", () => {
    expect(() => collectKeyVal("bad", {})).toThrow(CliError);
  });
});

describe("collectArray", () => {
  it("appends values", () => {
    expect(collectArray("b", collectArray("a", []))).toEqual(["a", "b"]);
  });
});

describe("parseList", () => {
  it("splits comma lists and accumulates", () => {
    expect(parseList("a,b", parseList("c", []))).toEqual(["c", "a", "b"]);
  });
  it("trims and drops empties", () => {
    expect(parseList(" a , , b ", [])).toEqual(["a", "b"]);
  });
});

describe("parseIntOption", () => {
  it("parses integers", () => {
    expect(parseIntOption("42")).toBe(42);
  });
  it("throws on non-numbers", () => {
    expect(() => parseIntOption("abc")).toThrow(CliError);
  });
});
