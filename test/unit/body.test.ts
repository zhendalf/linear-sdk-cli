/**
 * `resolveBody`'s editor path: how `$VISUAL`/`$EDITOR` is read and run.
 * The "editor" here is a shell one-liner that writes into the file it is
 * handed, so nothing interactive is needed.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBody, shellSplit, editorCommand } from "../../src/lib/body.js";

let saved: Record<string, string | undefined>;
let dir: string;

beforeEach(() => {
  saved = { EDITOR: process.env.EDITOR, VISUAL: process.env.VISUAL };
  delete process.env.EDITOR;
  delete process.env.VISUAL;
  dir = mkdtempSync(join(tmpdir(), "linbody-"));
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("shellSplit", () => {
  it("splits on whitespace, honouring quotes and backslashes, without expanding anything", () => {
    expect(shellSplit("code --wait")).toEqual(["code", "--wait"]);
    expect(shellSplit("  subl   -w ")).toEqual(["subl", "-w"]);
    expect(shellSplit(`vim -c 'set ft=markdown' -f`)).toEqual(["vim", "-c", "set ft=markdown", "-f"]);
    expect(shellSplit(`"/Applications/My Editor.app/bin/edit" --wait`)).toEqual([
      "/Applications/My Editor.app/bin/edit",
      "--wait",
    ]);
    expect(shellSplit(`emacsclient\\ -t x`)).toEqual(["emacsclient -t", "x"]);
    expect(shellSplit(`sh -c 'printf "%s" "$1" > "$2"' sh`)).toEqual([
      "sh",
      "-c",
      'printf "%s" "$1" > "$2"',
      "sh",
    ]);
    expect(shellSplit(`a "b \\"c\\" d" e`)).toEqual(["a", 'b "c" d', "e"]);
    expect(shellSplit(`'$HOME'`)).toEqual(["$HOME"]);
    expect(shellSplit(`''`)).toEqual([""]);
    expect(shellSplit("")).toEqual([]);
  });

  it("refuses an unbalanced quote", () => {
    expect(() => shellSplit(`vim -c 'oops`)).toThrow(/Unbalanced quote/);
  });
});

describe("editorCommand", () => {
  it("prefers VISUAL over EDITOR (git's precedence), and defaults to vi", () => {
    expect(editorCommand({}).raw).toBe("vi");
    expect(editorCommand({ EDITOR: "nano" }).raw).toBe("nano");
    expect(editorCommand({ EDITOR: "nano", VISUAL: "code --wait" })).toEqual({
      raw: "code --wait",
      argv: ["code", "--wait"],
    });
  });
});

describe("the editor path of resolveBody", () => {
  it("runs an EDITOR that carries arguments (the VS Code / Sublime / vim -f case)", () => {
    // `/usr/bin/true --wait <file>` used to be spawned as one executable named
    // "/usr/bin/true --wait" → raw ENOENT.
    process.env.EDITOR = "/usr/bin/true --wait";
    expect(resolveBody({ interactive: true })).toBe("");
  });

  it("appends the file as the last argument and reads back what the editor wrote", () => {
    // A tiny "editor": prints its own arguments' tail into the file it is given.
    const script = join(dir, "ed.sh");
    writeFileSync(script, `#!/bin/sh\nprintf 'edited by %s' "$1" > "$2"\n`);
    chmodSync(script, 0o755);
    process.env.EDITOR = `${script} "my editor"`;
    expect(resolveBody({ interactive: true })).toBe("edited by my editor");
  });

  it("seeds the editor with the template, so an untouched session hands the original back", () => {
    process.env.EDITOR = "/usr/bin/true";
    expect(resolveBody({ interactive: true, template: "the current body\n" })).toBe("the current body");
  });

  it("names the editor and the variable when it cannot be run", () => {
    process.env.EDITOR = "definitely-not-an-editor-xyz --wait";
    expect(() => resolveBody({ interactive: true })).toThrow(
      /Editor 'definitely-not-an-editor-xyz' not found \(from EDITOR='definitely-not-an-editor-xyz --wait'\)/,
    );
    process.env.VISUAL = "also-missing";
    expect(() => resolveBody({ interactive: true })).toThrow(/from VISUAL='also-missing'/);
  });

  it("treats a non-zero editor exit as failure rather than saving what was there", () => {
    process.env.EDITOR = "/usr/bin/false";
    expect(() => resolveBody({ interactive: true, template: "x" })).toThrow(/exited with status 1; nothing was saved/);
  });

  it("is not consulted at all when a body argument or file is given", () => {
    process.env.EDITOR = "definitely-not-an-editor-xyz";
    expect(resolveBody({ arg: "given", interactive: true })).toBe("given");
    const file = join(dir, "b.md");
    writeFileSync(file, "from file");
    expect(resolveBody({ file, interactive: true })).toBe("from file");
  });
});
