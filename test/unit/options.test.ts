import { describe, it, expect } from "bun:test";
import { Command } from "commander";
import {
  collectKeyVal,
  collectArray,
  parseList,
  parseIntOption,
  parsePositiveInt,
  addAliasOption,
  readAlias,
} from "../../src/lib/options.js";
import { CliError } from "../../src/lib/errors.js";
import { Context } from "../../src/context.js";

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

describe("parsePositiveInt (--limit)", () => {
  it("accepts positive integers", () => {
    expect(parsePositiveInt("1")).toBe(1);
    expect(parsePositiveInt("50")).toBe(50);
  });
  // The reference CLI spells "no limit" as `--limit 0`; Context.limit maps it
  // onto --all rather than the 50-row default.
  it("accepts zero (the reference CLI's spelling of --all)", () => {
    expect(parsePositiveInt("0")).toBe(0);
  });
  it("rejects negatives, decimals, and trailing junk", () => {
    expect(() => parsePositiveInt("-1")).toThrow(CliError);
    expect(() => parsePositiveInt("1.5")).toThrow(CliError);
    expect(() => parsePositiveInt("12x")).toThrow(/got '12x'/);
  });
  it("rejects leading zeros (including '00')", () => {
    expect(() => parsePositiveInt("01")).toThrow(CliError);
    expect(() => parsePositiveInt("00")).toThrow(CliError);
  });
});

describe("Context.limit", () => {
  it("--limit 0 exhausts pagination, exactly like --all", () => {
    expect(new Context({ limit: 0 }).limit).toBe(Infinity);
    expect(new Context({ all: true }).limit).toBe(Infinity);
  });
  it("leaves the existing limit/default behavior alone", () => {
    expect(new Context({ limit: 7 }).limit).toBe(7);
    expect(new Context({}).limit).toBe(50);
  });
});

describe("readAlias (long-flag aliases)", () => {
  it("reads either spelling, camel-casing the option key like commander", () => {
    expect(readAlias<string>({ due: "2026-01-01" }, "--due", "--due-date")).toBe("2026-01-01");
    expect(readAlias<string>({ dueDate: "2026-01-01" }, "--due", "--due-date")).toBe(
      "2026-01-01",
    );
    expect(readAlias({}, "--due", "--due-date")).toBeUndefined();
  });
  it("errors when both spellings are passed rather than silently picking one", () => {
    expect(() => readAlias({ due: "a", dueDate: "b" }, "--due", "--due-date")).toThrow(
      /Pass either --due or --due-date, not both/,
    );
    // Even when they agree — the rule is "one spelling", with no guessing.
    expect(() => readAlias({ due: "a", dueDate: "a" }, "--due", "--due-date")).toThrow(CliError);
  });
  it("handles multi-segment flags and value placeholders", () => {
    expect(readAlias<boolean>({ allStates: true }, "--all-states", "--every-state")).toBe(true);
    expect(readAlias<string>({ query: "x" }, "--query <text>", "--search <text>")).toBe("x");
  });
});

describe("addAliasOption", () => {
  it("registers the alias hidden, so --help and `linear commands` stay canonical", () => {
    const cmd = new Command("demo").option("--due <date>", "due date");
    addAliasOption(cmd, "--due-date <date>", "--due");
    const alias = cmd.options.find((o) => o.long === "--due-date");
    expect(alias).toBeDefined();
    expect((alias as any).hidden).toBe(true);
    expect(cmd.helpInformation()).not.toContain("--due-date");
    expect(cmd.helpInformation()).toContain("--due <date>");
  });

  it("parses the alias into the camel-cased key readAlias expects", () => {
    const cmd = new Command("demo").option("--due <date>", "due date").exitOverride();
    addAliasOption(cmd, "--due-date <date>", "--due");
    cmd.parse(["node", "demo", "--due-date", "2026-03-04"]);
    expect(readAlias<string>(cmd.opts(), "--due", "--due-date")).toBe("2026-03-04");
  });
});
