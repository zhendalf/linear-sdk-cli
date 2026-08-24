import { describe, it, expect, vi, afterEach, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Output } from "../../src/output/format.js";
import { CliError } from "../../src/lib/errors.js";
import { setPaginationMetadata } from "../../src/lib/pagination.js";
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

  it("list keeps its bare JSON array while warning on stderr when the limit hid results", () => {
    const cols: Column<{ id: string }>[] = [{ key: "id", value: (r) => r.id }];
    const rows = setPaginationMetadata([{ id: "A" }, { id: "B" }], true);
    const { out, err } = capture(() => jsonOutput().list(rows, cols));
    expect(JSON.parse(out)).toEqual([{ id: "A" }, { id: "B" }]);
    expect(err).toContain(
      "Showing 2 results; more exist. Use --all or increase --limit to see them.",
    );
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

  it("error suggestion is an additive structured field", () => {
    const error = new CliError("nope", "not_found", undefined, "Check the identifier.");
    const { err } = capture(() => jsonOutput().error(error));
    expect(JSON.parse(err)).toEqual({
      error: {
        message: "nope",
        code: "not_found",
        suggestion: "Check the identifier.",
      },
    });
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

  /**
   * `--fields` under --json is a projection of top-level keys (TES-635). It
   * used to be ignored there — and validated only in human list mode, so
   * `--fields nope --json` exited 0 with every key.
   */
  describe("--fields under --json", () => {
    const withFields = (fields: string[]) =>
      new Output({ json: true, color: false, quiet: false, debug: false, fields });
    const cols: Column<{ id: string; name: string; url: string }>[] = [
      { key: "id", value: (r) => r.id },
    ];

    it("list → each row keeps only the named keys, in that order", () => {
      const { out } = capture(() =>
        withFields(["name", "id"]).list([{ id: "1", name: "a", url: "u" }], cols),
      );
      expect(JSON.parse(out)).toEqual([{ name: "a", id: "1" }]);
    });

    it("detail → the object keeps only the named keys", () => {
      const { out } = capture(() =>
        withFields(["url"]).detail({ id: "1", name: "a", url: "u" }, [["Name", "a"]]),
      );
      expect(JSON.parse(out)).toEqual({ url: "u" });
    });

    it("an unknown key is a usage error, and nothing reaches stdout", () => {
      expect(() =>
        capture(() => withFields(["nope"]).list([{ id: "1", name: "a", url: "u" }], cols)),
      ).toThrow(/Unknown field 'nope'/);
    });

    it("an empty list stays an empty list", () => {
      const { out } = capture(() => withFields(["nope"]).list([], cols));
      expect(JSON.parse(out)).toEqual([]);
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

  it("uses a contextual empty-list message without changing JSON's []", () => {
    const columns: Column<{ id: string }>[] = [{ key: "id", value: (row) => row.id }];
    const human = new Output({ json: false, color: false, quiet: false, debug: false });
    expect(
      capture(() => human.list([], columns, { empty: "No active members; use --all." })).out,
    ).toBe("No active members; use --all.\n");
    expect(
      JSON.parse(
        capture(() =>
          jsonOutput().list([], columns, { empty: "This must never replace the array." }),
        ).out,
      ),
    ).toEqual([]);
  });

  it("renders Markdown only on a TTY, preserves it for pipes, and suppresses it in JSON", () => {
    const tty = new Output({
      json: false,
      color: false,
      quiet: false,
      debug: false,
      isTTY: true,
      terminalRows: 50,
    });
    expect(capture(() => tty.markdown("# Title\n\nA **bold** word.", { pager: false })).out).toBe(
      "Title\n\nA bold word.\n",
    );

    const pipe = new Output({
      json: false,
      color: false,
      quiet: false,
      debug: false,
      isTTY: false,
    });
    expect(capture(() => pipe.markdown("# Title\n\nA **bold** word.")).out).toBe(
      "# Title\n\nA **bold** word.\n",
    );
    expect(capture(() => jsonOutput().markdown("# never")).out).toBe("");
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

  function run(
    args: string[],
    extraEnv: NodeJS.ProcessEnv = {},
  ): { code: number; stdout: string; stderr: string } {
    const env: NodeJS.ProcessEnv = { ...process.env, XDG_CONFIG_HOME: home, HOME: home };
    delete env.LINEAR_API_KEY;
    delete env.LINEAR_API_TOKEN;
    delete env.LINEAR_WORKSPACE;
    delete env.LINEAR_DEBUG;
    Object.assign(env, extraEnv);
    // `--no-env-file`: a stray .env must not re-inject a key.
    const r = spawnSync("bun", ["--no-env-file", BIN, ...args], {
      encoding: "utf8",
      env,
      cwd: home,
    });
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

  it("LINEAR_DEBUG=1 is equivalent to --debug at the parse-time boundary", () => {
    const r = run(["whoami", "--definitely-not-a-flag", "-j"], { LINEAR_DEBUG: "1" });
    const error = JSON.parse(r.stderr).error;
    expect(error.code).toBe("usage");
    expect(error.detail).toBe("commander.unknownOption");
  });

  it("without the flag, the human error line — never JSON", () => {
    const r = run(["issue", "view", "TES-1"]);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^error: /);
    expect(() => JSON.parse(r.stderr)).toThrow();
  });

  /**
   * TES-633. `.showHelpAfterError()` was configured and dead: the stderr it
   * would have written was the one the boundary suppresses. The hint is now a
   * structured suggestion; a bare group prints its help; an unknown top-level
   * word is an unknown command, not "too many arguments".
   */
  describe("usage errors point at help (TES-633)", () => {
    it("a parse failure names the failing command's --help, in both modes", () => {
      const human = run(["issue", "create", "--nope"]);
      expect(human.code).toBe(2);
      expect(human.stderr.trimEnd()).toBe(
        [
          "error: unknown option '--nope'.",
          "hint: Run 'linear issue create --help' for usage.",
        ].join("\n"),
      );
      const json = run(["issue", "create", "--nope", "-j"]);
      const structured = JSON.parse(json.stderr).error;
      expect(structured.message).toBe("unknown option '--nope'.");
      expect(structured.suggestion).toBe("Run 'linear issue create --help' for usage.");
    });

    it("an unknown top-level word is an unknown command, with a guess", () => {
      const r = run(["issues", "list", "-j"]);
      expect(r.code).toBe(2);
      expect(envelope(r.stderr).message).toBe(
        "Unknown command 'issues'. Did you mean 'issue'? Run 'linear --help' to see the commands.",
      );
    });

    it("a bare group prints that group's help to stderr and exits 2 — the JSON is a usage error", () => {
      const human = run(["notification"]);
      expect(human.code).toBe(2);
      expect(human.stdout).toBe("");
      expect(human.stderr).toContain("Usage: linear notification|notif [options] [command]");
      expect(human.stderr).toContain("read-all");
      const json = run(["notification", "--json"]);
      expect(json.code).toBe(2);
      const structured = JSON.parse(json.stderr).error;
      expect(structured.message).toBe("Missing subcommand.");
      expect(structured.suggestion).toBe("Run 'linear notification --help' to see the commands.");
    });
  });
});

/**
 * TES-623: API data is written to a terminal only after terminal escapes are
 * stripped — and to JSON exactly as it is. A title carrying `\e[31m` used to
 * reach `issue title`'s bare line and every status line untouched.
 */
describe("terminal hygiene vs. JSON fidelity", () => {
  const ESC = String.fromCharCode(27);
  const evil = `x ${ESC}[31mRED${ESC}[0m ${ESC}]8;;https://evil.example${ESC}\\link${ESC}]8;;${ESC}\\ y`;
  const human = () => new Output({ json: false, color: false, quiet: false, debug: false });

  it("human line/info/success/warn strip escape sequences", () => {
    const { out, err } = capture(() => {
      const o = human();
      o.line(evil);
      o.info(evil);
      o.success(evil);
      o.warn(evil);
    });
    expect(out).toBe("x RED link y\n");
    expect(err).not.toContain(ESC);
    expect(err.split("\n").filter(Boolean)).toHaveLength(3);
  });

  it("the human error line strips them too", () => {
    const { err } = capture(() => human().error(new CliError(evil, "not_found")));
    expect(err).toBe("error: x RED link y\n");
  });

  it("the human suggestion and debug detail are sanitized too", () => {
    const error = new CliError("bad", "api", { remote: evil }, evil);
    const output = new Output({ json: false, color: false, quiet: false, debug: true });
    const { err } = capture(() => output.error(error));
    expect(err).toContain("hint: x RED link y");
    // JSON.stringify represents the remote control bytes as inert text.
    expect(err).toContain("\\u001b[31mRED");
    expect(err).not.toContain(ESC);
  });

  it("JSON carries the exact bytes (escaped by JSON itself), stdout and the error envelope alike", () => {
    const { out } = capture(() => jsonOutput().detail({ title: evil }, [["Title", evil]]));
    expect(JSON.parse(out).title).toBe(evil);
    const { err } = capture(() => jsonOutput().error(new CliError(evil, "not_found")));
    expect(JSON.parse(err).error.message).toBe(evil);
  });
});
