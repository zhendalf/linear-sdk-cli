import { describe, it, expect, vi, afterEach, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  /**
   * `--json --debug` is the combination a caller reaches for when a scripted
   * call misbehaves, and it was the one that produced unparseable output: the
   * debug detail was appended after the envelope as a second, plaintext block,
   * so `linear … --json --debug 2>&1 | jq` died with "Invalid numeric literal".
   */
  describe("--json --debug", () => {
    const debugOutput = () => new Output({ json: true, color: false, quiet: false, debug: true });
    const withDetail = () =>
      new CliError("boom", "api", [{ message: "boom", extensions: { type: "GraphqlError" } }]);

    it("stderr is exactly ONE JSON value, with nothing appended after it", () => {
      const { err } = capture(() => debugOutput().error(withDetail()));
      // The real check: parse the whole stream, not just its first object.
      expect(() => JSON.parse(err)).not.toThrow();
      expect(err.trimEnd().split("\n")).toHaveLength(1);
    });

    it("carries the debug detail INSIDE the envelope, under error.detail", () => {
      const { err } = capture(() => debugOutput().error(withDetail()));
      const parsed = JSON.parse(err);
      expect(parsed.error.message).toBe("boom");
      expect(parsed.error.code).toBe("api");
      expect(parsed.error.detail).toEqual([
        { message: "boom", extensions: { type: "GraphqlError" } },
      ]);
    });

    it("omits `detail` entirely without --debug, so the locked shape is unchanged", () => {
      const { err } = capture(() => jsonOutput().error(withDetail()));
      expect(JSON.parse(err)).toEqual({ error: { message: "boom", code: "api" } });
    });

    it("omits `detail` when --debug is on but the error carries none", () => {
      const { err } = capture(() => debugOutput().error(new CliError("plain", "usage")));
      expect(JSON.parse(err)).toEqual({ error: { message: "plain", code: "usage" } });
    });

    it("human mode keeps the detail as a readable second block", () => {
      const o = new Output({ json: false, color: false, quiet: false, debug: true });
      const { err } = capture(() => o.error(withDetail()));
      expect(err).toContain("error: boom");
      expect(err).toContain("detail: ");
    });
  });

  /**
   * Declining a destructive prompt used to return before any output call:
   * exit 0, empty stdout, indistinguishable from a delete that succeeded.
   */
  describe("cancellation receipt", () => {
    it("json mode → a parseable receipt on stdout, nothing on stderr", () => {
      const { out, err } = capture(() => jsonOutput().cancelled("Delete label bug?"));
      expect(JSON.parse(out)).toEqual({ cancelled: true, action: "Delete label bug?" });
      expect(err).toBe("");
    });

    it("human mode → a stderr note, and stdout stays clean", () => {
      const o = new Output({ json: false, color: false, quiet: false, debug: false });
      const { out, err } = capture(() => o.cancelled("Delete label bug?"));
      expect(out).toBe("");
      expect(err).toContain("Cancelled: Delete label bug?");
    });

    it("--quiet silences the human note but never the JSON receipt", () => {
      const quietHuman = new Output({ json: false, color: false, quiet: true, debug: false });
      expect(capture(() => quietHuman.cancelled("x")).err).toBe("");
      const quietJson = new Output({ json: true, color: false, quiet: true, debug: false });
      expect(JSON.parse(capture(() => quietJson.cancelled("x")).out)).toEqual({
        cancelled: true,
        action: "x",
      });
    });
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

/**
 * The tests above exercise the `Output` class. The error *boundary* in
 * `src/bin/linear.ts` decides which mode `Output` runs in, and it used to do so
 * by scanning argv for the literal `--json` — so `-j`, the alias the README
 * advertises, got a plaintext error and a script got an unparseable stream.
 * Nothing here caught it because nothing here ran the binary. These do: they
 * spawn the real entry point with an isolated config (no key anywhere) so a
 * failure is guaranteed without a network round-trip, and assert the envelope
 * under every spelling of the flag.
 */
describe("error boundary (spawned bin)", () => {
  const BIN = join(import.meta.dir, "..", "..", "src", "bin", "linear.ts");
  const home = mkdtempSync(join(tmpdir(), "lincli-envelope-"));
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  function run(args: string[]): { code: number; stdout: string; stderr: string } {
    const env: NodeJS.ProcessEnv = { ...process.env, XDG_CONFIG_HOME: home, HOME: home };
    delete env.LINEAR_API_KEY;
    delete env.LINEAR_API_TOKEN;
    delete env.LINEAR_WORKSPACE;
    // `--no-env-file`: a stray .env must not re-inject a key.
    const r = spawnSync("bun", ["--no-env-file", BIN, ...args], { encoding: "utf8", env, cwd: home });
    return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
  }

  const envelope = (stderr: string) => {
    const parsed = JSON.parse(stderr);
    expect(Object.keys(parsed)).toEqual(["error"]);
    expect(typeof parsed.error.message).toBe("string");
    expect(typeof parsed.error.code).toBe("string");
    return parsed.error as { message: string; code: string };
  };

  it("an action failure under --json → the envelope, exit code from the error", () => {
    const r = run(["issue", "view", "TES-1", "--json"]);
    expect(r.stdout).toBe("");
    expect(envelope(r.stderr).code).toBe("auth");
    expect(r.code).toBe(4);
  });

  it("the same failure under -j → the same envelope", () => {
    const r = run(["issue", "view", "TES-1", "-j"]);
    expect(r.stdout).toBe("");
    expect(envelope(r.stderr).code).toBe("auth");
    expect(r.code).toBe(4);
  });

  it("bundled short flags (-jq) → still the envelope", () => {
    const r = run(["issue", "view", "TES-1", "-jq"]);
    expect(envelope(r.stderr).code).toBe("auth");
  });

  it("the flag before the subcommand (`linear -j issue …`) → still the envelope", () => {
    const r = run(["-j", "issue", "view", "TES-1"]);
    expect(envelope(r.stderr).code).toBe("auth");
  });

  it("a parse-time usage error under -j → the envelope with code usage, exit 2", () => {
    const r = run(["whoami", "--definitely-not-a-flag", "-j"]);
    expect(r.stdout).toBe("");
    const err = envelope(r.stderr);
    expect(err.code).toBe("usage");
    expect(err.message).toContain("--definitely-not-a-flag");
    expect(r.code).toBe(2);
  });

  it("without the flag, the human error line — never JSON", () => {
    const r = run(["issue", "view", "TES-1"]);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^error: /);
    expect(() => JSON.parse(r.stderr)).toThrow();
  });
});
