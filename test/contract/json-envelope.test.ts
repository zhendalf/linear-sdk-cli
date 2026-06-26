import { describe, it, expect, vi, afterEach } from "bun:test";
import { Output } from "../../src/output/format.js";
import { CliError } from "../../src/lib/errors.js";
import type { Column } from "../../src/output/table.js";

/** Capture everything written to stdout/stderr during `fn`. */
function capture(fn: () => void): { out: string; err: string } {
  let out = "";
  let err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
    out += c;
    return true;
  });
  const e = vi.spyOn(process.stderr, "write").mockImplementation((c: any) => {
    err += c;
    return true;
  });
  try {
    fn();
  } finally {
    o.mockRestore();
    e.mockRestore();
  }
  return { out, err };
}

afterEach(() => vi.restoreAllMocks());

const jsonOutput = () => new Output({ json: true, color: false, quiet: false, debug: false });

describe("JSON envelope contract", () => {
  it("list → a bare JSON array on stdout", () => {
    const cols: Column<{ id: string }>[] = [{ key: "id", value: (r) => r.id }];
    const { out, err } = capture(() => jsonOutput().list([{ id: "A" }, { id: "B" }], cols));
    expect(JSON.parse(out)).toEqual([{ id: "A" }, { id: "B" }]);
    expect(err).toBe("");
  });

  it("list → uses jsonRows override when provided", () => {
    const cols: Column<{ id: string }>[] = [{ key: "id", value: (r) => r.id }];
    const { out } = capture(() => jsonOutput().list([{ id: "A" }], cols, [{ identifier: "A" }]));
    expect(JSON.parse(out)).toEqual([{ identifier: "A" }]);
  });

  it("detail → a bare JSON object on stdout", () => {
    const { out } = capture(() => jsonOutput().detail({ id: "X", name: "n" }, [["Name", "n"]]));
    expect(JSON.parse(out)).toEqual({ id: "X", name: "n" });
  });

  it("emit → the provided value, human renderer is skipped in json mode", () => {
    const human = vi.fn();
    const { out } = capture(() => jsonOutput().emit({ success: true, id: "1" }, human));
    expect(JSON.parse(out)).toEqual({ success: true, id: "1" });
    expect(human).not.toHaveBeenCalled();
  });

  it("error → {error:{message,code}} on stderr, nothing on stdout", () => {
    const { out, err } = capture(() => jsonOutput().error(new CliError("nope", "not_found")));
    expect(out).toBe("");
    expect(JSON.parse(err)).toEqual({ error: { message: "nope", code: "not_found" } });
  });

  it("status output (info/success) never pollutes stdout in json mode", () => {
    const { out, err } = capture(() => {
      const o = jsonOutput();
      o.info("working...");
      o.success("done");
      o.line("ignored human line");
    });
    expect(out).toBe("");
    expect(err).toContain("working...");
  });
});

describe("human mode", () => {
  it("emit runs the human renderer and writes nothing as JSON", () => {
    const o = new Output({ json: false, color: false, quiet: false, debug: false });
    const { out } = capture(() => o.emit({ a: 1 }, () => process.stdout.write("HUMAN\n")));
    expect(out).toBe("HUMAN\n");
  });
});
