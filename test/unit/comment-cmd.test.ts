/**
 * `linear comment update <id> [body]` through the real program: the editor
 * opens on the current body, and an empty or unchanged result is refused —
 * so quitting a blank editor can no longer wipe a comment (TES-620).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";
import { payload } from "./_fakes.js";

let dir: string;
let savedEnv: Record<string, string | undefined>;
let clientDescriptor: PropertyDescriptor | undefined;
let stdinTTY: unknown;
let stdoutTTY: unknown;

/** What the fake client saw. */
let updates: Array<{ id: string; input: any }>;
let currentBody: string;

function fakeClient() {
  return {
    // getComment goes through rawRequest (the typed getter is broken in the SDK).
    client: {
      rawRequest: async (_query: string, vars: any) => ({
        data: {
          comment: {
            id: vars.id,
            body: currentBody,
            issueId: "issue-1",
            issue: { id: "issue-1", identifier: "TES-1" },
          },
        },
      }),
    },
    updateComment: async (id: string, input: any) => {
      updates.push({ id, input });
      return payload("comment", { id, url: "https://linear.app/c/1" });
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lincmupd-"));
  savedEnv = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    HOME: process.env.HOME,
    LINEAR_API_KEY: process.env.LINEAR_API_KEY,
    EDITOR: process.env.EDITOR,
    VISUAL: process.env.VISUAL,
  };
  process.env.XDG_CONFIG_HOME = join(dir, "xdg");
  process.env.HOME = dir;
  process.env.LINEAR_API_KEY = "lin_api_test000000000000";
  delete process.env.VISUAL;
  updates = [];
  currentBody = "the current body";
  clientDescriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
  Object.defineProperty(Context.prototype, "client", { get: () => fakeClient(), configurable: true });
  stdinTTY = (process.stdin as any).isTTY;
  stdoutTTY = (process.stdout as any).isTTY;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (clientDescriptor) Object.defineProperty(Context.prototype, "client", clientDescriptor);
  (process.stdin as any).isTTY = stdinTTY;
  (process.stdout as any).isTTY = stdoutTTY;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

const run = (args: string[]) => createProgram().parseAsync(["node", "linear", ...args]);

/** Make the process look interactive so `ctx.isTTY` — and thus the editor path — is on. */
function interactive() {
  (process.stdin as any).isTTY = true;
  (process.stdout as any).isTTY = true;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

describe("comment update", () => {
  it("an explicit empty body is refused, and nothing is sent", async () => {
    await expect(run(["comment", "update", "c1", "", "--json"])).rejects.toThrow(/Refusing to blank/);
    await expect(run(["comment", "update", "c1", "   ", "--json"])).rejects.toThrow(/Refusing to blank/);
    expect(updates).toEqual([]);
  });

  it("an unchanged body is refused, and nothing is sent", async () => {
    await expect(run(["comment", "update", "c1", "the current body", "--json"])).rejects.toThrow(
      /unchanged/,
    );
    expect(updates).toEqual([]);
  });

  it("a new body goes through", async () => {
    let out = "";
    vi.spyOn(process.stdout, "write").mockImplementation((c: any) => ((out += c), true));
    await run(["comment", "update", "c1", "a new body", "--json"]);
    expect(updates).toEqual([{ id: "c1", input: { body: "a new body" } }]);
    expect(JSON.parse(out)).toEqual({ id: "c1", url: "https://linear.app/c/1" });
  });

  it("the editor opens ON the current body — quitting it untouched is 'unchanged', not a wipe", async () => {
    interactive();
    // An "editor" that records what it was handed, and leaves it as is.
    const seen = join(dir, "seen.md");
    const ed = join(dir, "ed.sh");
    writeFileSync(ed, `#!/bin/sh\ncat "$1" > "${seen}"\n`);
    chmodSync(ed, 0o755);
    process.env.EDITOR = ed;
    await expect(run(["comment", "update", "c1"])).rejects.toThrow(/unchanged/);
    expect(readFileSync(seen, "utf8")).toBe("the current body");
    expect(updates).toEqual([]);
  });

  it("an editor that empties the file is refused too", async () => {
    interactive();
    const ed = join(dir, "ed.sh");
    writeFileSync(ed, `#!/bin/sh\n: > "$1"\n`);
    chmodSync(ed, 0o755);
    process.env.EDITOR = ed;
    await expect(run(["comment", "update", "c1"])).rejects.toThrow(/Refusing to blank/);
    expect(updates).toEqual([]);
  });

  it("an editor that changes the file saves the change (with an EDITOR that carries arguments)", async () => {
    interactive();
    const ed = join(dir, "ed.sh");
    writeFileSync(ed, `#!/bin/sh\n[ "$1" = "--wait" ] || exit 9\nprintf 'rewritten' > "$2"\n`);
    chmodSync(ed, 0o755);
    process.env.EDITOR = `${ed} --wait`;
    await run(["comment", "update", "c1"]);
    expect(updates).toEqual([{ id: "c1", input: { body: "rewritten" } }]);
  });

  it("without a terminal and without a body, it is a usage error — no editor, no wipe", async () => {
    await expect(run(["comment", "update", "c1", "--json"])).rejects.toThrow(/No comment body provided/);
    expect(updates).toEqual([]);
  });
});
