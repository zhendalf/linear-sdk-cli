/**
 * Resolve a text body (issue/comment/document content) from, in priority:
 *   1. an explicit positional/flag argument
 *   2. --body-file <path>  ('-' reads stdin)
 *   3. $EDITOR  (only when interactive)
 *
 * Returns undefined when no source is available and interaction is not allowed.
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { usageError } from "./errors.js";

export interface BodyInputs {
  arg?: string;
  file?: string;
  /** Whether $EDITOR may be invoked (TTY + not --no-input/--json). */
  interactive: boolean;
  /**
   * The user explicitly asked for the editor (`--editor`). Kept separate from
   * `interactive` so an unavailable editor fails instead of silently producing
   * an empty body — `--editor --json` used to create issues with no description
   * at all, since `--json` implies non-interactive.
   */
  editorRequested?: boolean;
  /** Initial content to seed the editor with. */
  template?: string;
}

export function resolveBody(inputs: BodyInputs): string | undefined {
  if (inputs.arg !== undefined) return inputs.arg;
  if (inputs.file !== undefined) return readBodyFile(inputs.file);
  if (inputs.interactive) return openEditor(inputs.template ?? "");
  if (inputs.editorRequested) {
    throw usageError(
      "--editor needs an interactive terminal, and is unavailable under --json, --no-input, " +
        "or when input/output is redirected. Pass the text directly or read it from a file.",
    );
  }
  return undefined;
}

function readBodyFile(file: string): string {
  if (file === "-") return readStdinSync();
  try {
    return readFileSync(file, "utf8");
  } catch (err) {
    throw usageError(`Cannot read body file '${file}': ${(err as Error).message}`);
  }
}

export function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function openEditor(template: string): string {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const dir = mkdtempSync(join(tmpdir(), "linear-"));
  const file = join(dir, "LINEAR_EDITMSG.md");
  try {
    writeFileSync(file, template, "utf8");
    execFileSync(editor, [file], { stdio: "inherit" });
    return readFileSync(file, "utf8").trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
