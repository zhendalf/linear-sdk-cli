/**
 * The Output object: the single sink for everything a command prints.
 *
 * JSON-mode contract (locked — scripts depend on it):
 *   - machine JSON is the ONLY thing written to stdout
 *   - lists → bare array, single resource → bare object, mutations → affected
 *     object (or {success,id} when there is no body)
 *   - status/progress/pagination notes → stderr
 *   - errors → {"error":{"message","code"}} on stderr + non-zero exit
 */

import pc from "picocolors";
import type { CliError } from "../lib/errors.js";
import { renderTable, renderDetail, selectColumns, type Column } from "./table.js";

export interface OutputOptions {
  json: boolean;
  color: boolean;
  quiet: boolean;
  debug: boolean;
  /** --fields selection applied to table/detail output. */
  fields?: string[];
}

export class Output {
  constructor(private readonly opts: OutputOptions) {}

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

  /** Emit a list as a table (human) or bare array (json). */
  list<T>(rows: T[], columns: Column<T>[], jsonRows?: unknown[]): void {
    if (this.opts.json) {
      this.writeJson(jsonRows ?? rows);
      return;
    }
    const cols = selectColumns(columns, this.opts.fields);
    process.stdout.write(renderTable(rows, cols, { color: this.opts.color }) + "\n");
  }

  /** Emit a single record as a detail block (human) or bare object (json). */
  detail(jsonValue: unknown, pairs: Array<[string, unknown]>): void {
    if (this.opts.json) {
      this.writeJson(jsonValue);
      return;
    }
    process.stdout.write(renderDetail(pairs, { color: this.opts.color }) + "\n");
  }

  /** Raw stdout line (human mode only); in json mode this is suppressed. */
  line(text = ""): void {
    if (!this.opts.json) process.stdout.write(text + "\n");
  }

  /** Status/progress to stderr. Suppressed by --quiet. */
  info(text: string): void {
    if (!this.opts.quiet) process.stderr.write(text + "\n");
  }

  success(text: string): void {
    if (!this.opts.quiet) process.stderr.write((this.opts.color ? pc.green("✓ ") : "✓ ") + text + "\n");
  }

  warn(text: string): void {
    process.stderr.write((this.opts.color ? pc.yellow("! ") : "! ") + text + "\n");
  }

  /** Print a normalized error envelope to stderr. */
  error(err: CliError): void {
    if (this.opts.json) {
      process.stderr.write(JSON.stringify({ error: { message: err.message, code: err.code } }) + "\n");
    } else {
      process.stderr.write((this.opts.color ? pc.red("error: ") : "error: ") + err.message + "\n");
    }
    if (this.opts.debug && err.detail) {
      process.stderr.write(
        (this.opts.color ? pc.dim("detail: ") : "detail: ") +
          JSON.stringify(err.detail, null, 2) +
          "\n",
      );
    }
  }

  private writeJson(value: unknown): void {
    process.stdout.write(JSON.stringify(value, null, this.opts.json ? 2 : 0) + "\n");
  }
}
