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
import { spawnSync } from "node:child_process";
import { CliError, usageError } from "./errors.js";

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
  if (inputs.arg !== undefined) return validateInlineBody(inputs.arg);
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

/**
 * A quoted shell argument does not interpret `\n`. This is an especially easy
 * mistake for an agent composing Markdown in one command: Linear then stores
 * and renders the two literal characters, often across an entire issue body.
 *
 * Do not silently unescape them. A literal backslash-n can be intentional in
 * source code, JSON, or a regular expression, and changing it would corrupt
 * user data. File/stdin input is the unambiguous route for both real newlines
 * and intentional escape syntax.
 */
export function validateInlineBody(body: string): string {
  if (body.includes("\\n")) {
    throw usageError(
      "Inline text contains a literal \\n sequence; shell quotes do not turn it into a line break. " +
        "Use this command's *-file option with '-' and provide the Markdown on stdin. " +
        "If the literal \\n is intentional, file input preserves it unchanged.",
    );
  }
  return body;
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

/**
 * The editor command, git's way: `$VISUAL`, then `$EDITOR`, then `vi` — and
 * the value is a *command line*, not a program name. `code --wait`, `subl -w`,
 * `vim -f`, `emacsclient -t` are how those editors are documented to be set,
 * so it is split shell-style (quotes and backslashes honoured) into argv, and
 * the file is appended. Exported for tests.
 */
export function editorCommand(env: NodeJS.ProcessEnv = process.env): {
  raw: string;
  argv: string[];
} {
  const raw = env.VISUAL || env.EDITOR || "vi";
  return { raw, argv: shellSplit(raw) };
}

/**
 * Split one line into words the way a POSIX shell would for a simple command:
 * whitespace separates, single quotes are literal, double quotes allow `\"`
 * and `\\`, an unquoted backslash escapes the next character. No expansions —
 * `$HOME` stays `$HOME` — because an editor setting is not a shell script.
 */
export function shellSplit(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inWord = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote === "'") {
      if (c === "'") quote = null;
      else cur += c;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "\\" && i + 1 < line.length && '"\\'.includes(line[i + 1]!)) cur += line[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === "\\" && i + 1 < line.length) {
      cur += line[++i];
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) out.push(cur);
      cur = "";
      inWord = false;
    } else {
      cur += c;
      inWord = true;
    }
  }
  if (quote) throw usageError(`Unbalanced quote in editor setting: ${line}`);
  if (inWord) out.push(cur);
  return out;
}

function openEditor(template: string): string {
  const { raw, argv } = editorCommand();
  const [cmd, ...args] = argv;
  if (!cmd) throw usageError("VISUAL/EDITOR is set but empty; set it to an editor on your PATH.");
  const dir = mkdtempSync(join(tmpdir(), "linear-"));
  const file = join(dir, "LINEAR_EDITMSG.md");
  try {
    writeFileSync(file, template, "utf8");
    const r = spawnSync(cmd, [...args, file], { stdio: "inherit" });
    if (r.error) {
      const e = r.error as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        const from = process.env.VISUAL
          ? `VISUAL='${raw}'`
          : process.env.EDITOR
            ? `EDITOR='${raw}'`
            : "the default, neither VISUAL nor EDITOR being set";
        throw usageError(
          `Editor '${cmd}' not found (from ${from}). Set VISUAL or EDITOR to an editor on your PATH.`,
        );
      }
      throw new CliError(`Could not run editor '${raw}': ${e.message}`, "runtime");
    }
    if (r.status !== 0) {
      // git aborts here too: an editor that failed did not save what you meant.
      throw new CliError(
        `Editor '${raw}' exited with status ${r.status ?? `signal ${r.signal}`}; nothing was saved.`,
        "runtime",
      );
    }
    return readFileSync(file, "utf8").trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
