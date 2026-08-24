/**
 * The Output object: the single sink for everything a command prints.
 *
 * JSON-mode contract (locked — scripts depend on it):
 *   - machine JSON is the ONLY thing written to stdout
 *   - lists → bare array, single resource → bare object, mutations → affected
 *     object (or {success,id} when there is no body)
 *   - status/progress/pagination notes → stderr
 *   - errors → {"error":{"message","code", …optional additive fields}} on stderr + non-zero exit
 */

import pc from "picocolors";
import type { CliError } from "../lib/errors.js";
import {
  renderTable,
  renderDetail,
  selectColumns,
  selectPairs,
  projectFields,
  type Column,
} from "./table.js";
import { sanitizeForTerminal } from "./sanitize.js";
import { renderMarkdown } from "./markdown.js";
import { pageOutput, shouldUsePager } from "./pager.js";
import { hasMoreResults } from "../lib/pagination.js";

export interface OutputOptions {
  json: boolean;
  color: boolean;
  quiet: boolean;
  debug: boolean;
  /** `--fields`: table columns / detail lines (human), top-level keys (json). */
  fields?: string[];
  /** Injectable terminal facts; default to stdout's live state. */
  isTTY?: boolean;
  terminalRows?: number;
  terminalColumns?: number;
  /** Used only to resolve PAGER when long-form output is eligible. */
  env?: NodeJS.ProcessEnv;
}

export interface ListOutputOptions {
  /** JSON rows may be richer/differently shaped than the human table rows. */
  jsonRows?: unknown[];
  /** Context shown instead of the default `(no results)` in human mode. */
  empty?: string;
}

export interface MarkdownOutputOptions {
  /** Leave Markdown syntax intact (terminal controls are still removed). */
  raw?: boolean;
  /** Commands with `--no-pager` pass false. Defaults to enabled. */
  pager?: boolean;
}

export class Output {
  private readonly opts: OutputOptions;
  private readonly colors: ReturnType<typeof pc.createColors>;

  constructor(opts: OutputOptions) {
    this.opts = opts;
    // Do not rely on picocolors' module-load-time environment detection:
    // CLICOLOR_FORCE and per-stream TTY policy are resolved by Context.
    this.colors = pc.createColors(opts.color);
  }

  get json(): boolean {
    return this.opts.json;
  }

  get color(): boolean {
    return this.opts.color;
  }

  /** Emit a primary result: JSON in json-mode, else run the human renderer. */
  emit(value: unknown, human: () => void): void {
    if (this.opts.json) {
      this.writeJson(value);
    } else {
      human();
    }
  }

  /**
   * Emit a list as a table (human) or bare array (json). `--fields` narrows
   * both: the table's columns (or any row key), and the JSON objects' keys.
   */
  list<T>(
    rows: T[],
    columns: Column<T>[],
    jsonRowsOrOptions?: unknown[] | ListOutputOptions,
    legacyOptions?: Pick<ListOutputOptions, "empty">,
  ): void {
    const options: ListOutputOptions = Array.isArray(jsonRowsOrOptions)
      ? { jsonRows: jsonRowsOrOptions, ...legacyOptions }
      : (jsonRowsOrOptions ?? {});
    if (hasMoreResults(rows)) {
      this.info(
        `Showing ${rows.length} results; more exist. Use --all or increase --limit to see them.`,
      );
    }
    if (this.opts.json) {
      this.writeJson(projectFields(options.jsonRows ?? rows, this.opts.fields));
      return;
    }
    const cols = selectColumns(columns, this.opts.fields, rows[0]);
    process.stdout.write(
      renderTable(rows, cols, { color: this.opts.color, empty: options.empty }) + "\n",
    );
  }

  /**
   * Emit a single record as a detail block (human) or bare object (json).
   * `--fields` narrows both: the block's labelled lines, and the JSON keys.
   */
  detail(jsonValue: unknown, pairs: Array<[string, unknown]>): void {
    if (this.opts.json) {
      this.writeJson(projectFields(jsonValue, this.opts.fields));
      return;
    }
    const shown = selectPairs(pairs, this.opts.fields);
    process.stdout.write(renderDetail(shown, { color: this.opts.color }) + "\n");
  }

  /**
   * Stdout line (human mode only); in json mode this is suppressed. Sanitized:
   * `issue title` prints API data bare, and a title can carry escapes.
   */
  line(text = ""): void {
    if (!this.opts.json) process.stdout.write(sanitizeForTerminal(text) + "\n");
  }

  /**
   * Render a long Markdown body for a human, optionally through a pager.
   *
   * Non-TTY output keeps the original Markdown so pipes/files receive stable,
   * reusable text. JSON mode writes nothing — callers normally put this inside
   * `emit(value, () => output.markdown(...))`, but the guard prevents an
   * accidental second stdout value. Both human paths remain terminal-sanitized.
   */
  markdown(text: string, options: MarkdownOutputOptions = {}): void {
    if (this.opts.json) return;

    const isTTY = this.opts.isTTY ?? process.stdout.isTTY === true;
    const columns = this.opts.terminalColumns ?? process.stdout.columns ?? 80;
    const rows = this.opts.terminalRows ?? process.stdout.rows;
    const content =
      isTTY && options.raw !== true
        ? renderMarkdown(text, { color: this.opts.color, width: columns })
        : sanitizeForTerminal(text);
    const output = content.endsWith("\n") ? content : `${content}\n`;

    if (
      shouldUsePager(output, {
        enabled: options.pager,
        json: this.opts.json,
        isTTY,
        rows,
        columns,
      }) &&
      pageOutput(output, { env: this.opts.env })
    ) {
      return;
    }
    process.stdout.write(output);
  }

  /** Status/progress to stderr. Suppressed by --quiet. */
  info(text: string): void {
    if (!this.opts.quiet) process.stderr.write(sanitizeForTerminal(text) + "\n");
  }

  success(text: string): void {
    if (!this.opts.quiet)
      process.stderr.write(this.colors.green("✓ ") + sanitizeForTerminal(text) + "\n");
  }

  warn(text: string): void {
    process.stderr.write(this.colors.yellow("! ") + sanitizeForTerminal(text) + "\n");
  }

  /**
   * A destructive action the user declined at the confirmation prompt.
   *
   * Declining is not a failure, so this is not the error envelope — but it is
   * not silence either. In JSON mode it is a real result on stdout, so a
   * pipeline still gets something parseable back instead of nothing; in human
   * mode it is a stderr note. The caller sets the exit code (see
   * `EXIT_CANCELLED` in lib/prompt.ts), which is what stops
   * `linear issue delete X && …` from running the `&&` side.
   */
  cancelled(action: string): void {
    if (this.opts.json) {
      this.writeJson({ cancelled: true, action });
      return;
    }
    if (!this.opts.quiet) {
      process.stderr.write(
        this.colors.yellow("! ") + `Cancelled: ${sanitizeForTerminal(action)}\n`,
      );
    }
  }

  /**
   * Print a normalized error envelope to stderr.
   *
   * In JSON mode `--debug` detail goes *inside* the envelope. It used to be
   * appended afterwards as a second, plaintext block, which meant the one
   * combination a caller reaches for when a scripted call misbehaves —
   * `--json --debug` — was the one that produced unparseable output:
   * `linear … --json --debug 2>&1 | jq` died on "Invalid numeric literal".
   */
  error(err: CliError): void {
    const showDetail = this.opts.debug && err.detail !== undefined;
    if (this.opts.json) {
      // `message` and `code` keep their positions; `detail` is additive, and
      // absent entirely without --debug.
      const error: Record<string, unknown> = { message: err.message, code: err.code };
      if (err.suggestion !== undefined) error.suggestion = err.suggestion;
      if (showDetail) error.detail = err.detail;
      process.stderr.write(JSON.stringify({ error }) + "\n");
      return;
    }
    // An error message can quote API data (a name that matched several, …).
    process.stderr.write(this.colors.red("error: ") + sanitizeForTerminal(err.message) + "\n");
    if (err.suggestion !== undefined) {
      process.stderr.write(this.colors.dim("hint: ") + sanitizeForTerminal(err.suggestion) + "\n");
    }
    if (showDetail) {
      const detail = JSON.stringify(err.detail, null, 2) ?? String(err.detail);
      process.stderr.write(this.colors.dim("detail: ") + sanitizeForTerminal(detail) + "\n");
    }
  }

  private writeJson(value: unknown): void {
    process.stdout.write(JSON.stringify(value, null, this.opts.json ? 2 : 0) + "\n");
  }
}
