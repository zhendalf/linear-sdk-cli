/**
 * Minimal dependency-free table renderer with truncation + optional color.
 */

import pc from "picocolors";
import { usageError } from "../lib/errors.js";

export interface Column<T> {
  /** Stable key used by --fields selection. */
  key: string;
  /** Header label (defaults to key). */
  header?: string;
  /** Cell accessor. */
  value: (row: T) => unknown;
  /** Max width before truncation (default 60). */
  max?: number;
}

// Built via fromCharCode to avoid a control char in a regex literal (no-control-regex).
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (s: string) => s.replace(ANSI_RE, "");
const displayWidth = (s: string) => stripAnsi(s).length;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return s.slice(0, max - 1) + "…";
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(cell).join(", ");
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Filter columns to a requested subset (by key or header, case-insensitive),
 * preserving requested order. An unknown field is a usage error rather than a
 * silent fall-through to all columns.
 */
export function selectColumns<T>(columns: Column<T>[], fields?: string[]): Column<T>[] {
  if (!fields || fields.length === 0) return columns;
  const byName = new Map<string, Column<T>>();
  for (const c of columns) {
    byName.set(c.key.toLowerCase(), c);
    if (c.header) byName.set(c.header.toLowerCase(), c);
  }
  const picked: Column<T>[] = [];
  for (const f of fields) {
    const col = byName.get(f.toLowerCase());
    if (!col) {
      throw usageError(
        `Unknown field '${f}'. Available: ${columns.map((c) => c.key).join(", ")}.`,
      );
    }
    picked.push(col);
  }
  return picked;
}

export function renderTable<T>(
  rows: T[],
  columns: Column<T>[],
  opts: { color?: boolean } = {},
): string {
  const color = opts.color ?? false;
  if (rows.length === 0) return color ? pc.dim("(no results)") : "(no results)";

  const headers = columns.map((c) => c.header ?? c.key);
  const body = rows.map((row) =>
    columns.map((c) => truncate(cell(c.value(row)), c.max ?? 60)),
  );

  const widths = columns.map((_, i) => {
    const header = headers[i] ?? "";
    const colMax = body.reduce((m, r) => Math.max(m, displayWidth(r[i] ?? "")), 0);
    return Math.max(displayWidth(header), colMax);
  });

  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - displayWidth(s)));

  const headerLine = headers
    .map((h, i) => pad(color ? pc.bold(h) : h, widths[i] ?? 0))
    .join("  ")
    .trimEnd();

  const lines = body.map((r) =>
    r
      .map((c, i) => pad(c, widths[i] ?? 0))
      .join("  ")
      .trimEnd(),
  );

  return [headerLine, ...lines].join("\n");
}

/** Render a single record as aligned key: value lines. */
export function renderDetail(
  pairs: Array<[string, unknown]>,
  opts: { color?: boolean } = {},
): string {
  const color = opts.color ?? false;
  const visible = pairs.filter(([, v]) => v !== undefined && v !== null);
  const keyWidth = visible.reduce((m, [k]) => Math.max(m, k.length), 0);
  return visible
    .map(([k, v]) => {
      const label = (k + ":").padEnd(keyWidth + 1);
      return `${color ? pc.dim(label) : label} ${cell(v)}`;
    })
    .join("\n");
}
