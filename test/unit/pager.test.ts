import { describe, expect, it, vi } from "bun:test";
import {
  pageOutput,
  pagerCommands,
  shouldUsePager,
  terminalLineCount,
} from "../../src/output/pager.js";

describe("pager policy", () => {
  it("counts both explicit lines and terminal wrapping", () => {
    expect(terminalLineCount("123456\n12", 5)).toBe(3);
  });

  it("uses a pager only for long TTY output", () => {
    const long = Array.from({ length: 25 }, (_, index) => `line ${index}`).join("\n");
    expect(shouldUsePager(long, { isTTY: true, rows: 20, columns: 80 })).toBe(true);
    expect(shouldUsePager("short", { isTTY: true, rows: 20 })).toBe(false);
    expect(shouldUsePager(long, { isTTY: false, rows: 20 })).toBe(false);
    expect(shouldUsePager(long, { isTTY: true, rows: 20, json: true })).toBe(false);
    expect(shouldUsePager(long, { isTTY: true, rows: 20, enabled: false })).toBe(false);
  });

  it("honors a quoted PAGER command before portable Unix fallbacks", () => {
    expect(pagerCommands({ PAGER: "less '-R -X'" }, "darwin")).toEqual([
      { command: "less", args: ["-R -X"] },
      { command: "less", args: ["-R", "-X"] },
      { command: "more", args: [] },
    ]);
  });

  it("uses more.com as the Windows fallback", () => {
    expect(pagerCommands({}, "win32")).toEqual([{ command: "more.com", args: [] }]);
  });

  it("falls through failed candidates and reports whether one succeeded", () => {
    const attempted: string[] = [];
    const run = vi.fn((candidate: { command: string }) => {
      attempted.push(candidate.command);
      return candidate.command === "more";
    });
    expect(pageOutput("body", { env: { PAGER: "missing" }, platform: "darwin", run })).toBe(true);
    expect(attempted).toEqual(["missing", "less", "more"]);
  });

  it("ignores malformed PAGER quoting instead of failing the CLI command", () => {
    expect(pagerCommands({ PAGER: "less 'unterminated" }, "darwin")[0]).toEqual({
      command: "less",
      args: ["-R", "-X"],
    });
  });
});
