/**
 * Minimal dependency-free table renderer with truncation + optional color.
 */

import pc from "picocolors";
import { usageError } from "../lib/errors.js";
import { sanitizeForTerminal, displayWidth } from "./sanitize.js";

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

/** Cut `s` to at most `max` terminal columns, by grapheme, with an ellipsis. */
function truncate(s: string, max: number): string {
  if (displayWidth(s) <= max) return s;
  if (max <= 1) return sliceToWidth(s, max);
  return sliceToWidth(s, max - 1) + "…";
}

/** The longest prefix of `s` that fits in `width` columns — whole graphemes only. */
function sliceToWidth(s: string, width: number): string {
  let out = "";
  let used = 0;
  for (const { segment } of new Intl.Segmenter().segment(s)) {
    const w = displayWidth(segment);
    if (used + w > width) break;
    out += segment;
    used += w;
  }
  return out;
}

/**
 * A value as a human cell. Every string that reaches a table or a detail block
 * passes through here, and this is where terminal escapes in API data die.
 *
 * A relation object (`{id, name}`, `{displayName}`, `{identifier}`) shows its
 * human name, so `--fields project,assignee` on a row that carries objects
 * reads as a table and not as `[object Object]`.
 */
export function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(cell).join(", ");
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const name = o.name ?? o.displayName ?? o.identifier ?? o.key ?? o.id;
    return name === undefined ? sanitizeForTerminal(JSON.stringify(v)) : cell(name);
  }
  return sanitizeForTerminal(String(v));
}

/**
 * Filter columns to a requested subset (by key or header, case-insensitive),
 * preserving requested order. A field that names no column but IS a key on the
 * rows becomes a column of that key's value — `issue list --fields id,title,
 * labels` used to be `Unknown field 'labels'` while every row carried labels,
 * project, url, updatedAt and estimate. An unknown field is a usage error
 * rather than a silent fall-through to all columns, and it lists both kinds.
 */
export function selectColumns<T>(columns: Column<T>[], fields?: string[], sample?: T): Column<T>[] {
  if (!fields || fields.length === 0) return columns;
  const byName = new Map<string, Column<T>>();
  for (const c of columns) {
    byName.set(c.key.toLowerCase(), c);
    if (c.header) byName.set(c.header.toLowerCase(), c);
  }
  const rowKeys = sample && typeof sample === "object" ? Object.keys(sample as object) : [];
  const picked: Column<T>[] = [];
  for (const f of fields) {
    const col = byName.get(f.toLowerCase());
    if (col) {
      picked.push(col);
      continue;
    }
    const key = rowKeys.find((k) => k.toLowerCase() === f.toLowerCase());
    if (key === undefined) {
      const extra = rowKeys.filter((k) => !byName.has(k.toLowerCase()));
      throw usageError(
        `Unknown field '${f}'. Available: ${columns.map((c) => c.key).join(", ")}${
          extra.length ? `; also any row key: ${extra.join(", ")}` : ""
        }.`,
      );
    }
    picked.push({ key, header: key, value: (row) => (row as Record<string, unknown>)[key] });
  }
  return picked;
}

/**
 * `--fields` under `--json`: keep only the named top-level keys of each object,
 * in the order asked. Keys are matched exactly (JSON is case-sensitive), and an
 * unknown key is a usage error naming the real ones — it used to be silently
 * ignored, so `--fields nope --json` exited 0 with every key while
 * `--fields nope` exited 2. An empty list has nothing to check and stays `[]`.
 */
export function projectFields<T>(value: T, fields?: string[]): T {
  if (!fields || fields.length === 0) return value;
  const pick = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (!(f in obj)) {
        throw usageError(`Unknown field '${f}'. Available: ${Object.keys(obj).join(", ")}.`);
      }
      out[f] = obj[f];
    }
    return out;
  };
  if (Array.isArray(value)) {
    return value.map((row) =>
      row && typeof row === "object" ? pick(row as Record<string, unknown>) : row,
    ) as T;
  }
  if (value && typeof value === "object") return pick(value as Record<string, unknown>) as T;
  return value;
}

/**
 * `--fields` on a human detail block: keep the pairs whose label matches
 * (case-insensitively), in the order asked. Unknown → usage error naming the
 * labels there are.
 */
export function selectPairs(
  pairs: Array<[string, unknown]>,
  fields?: string[],
): Array<[string, unknown]> {
  if (!fields || fields.length === 0) return pairs;
  const picked: Array<[string, unknown]> = [];
  for (const f of fields) {
    const pair = pairs.find(([label]) => label.toLowerCase() === f.toLowerCase());
    if (!pair) {
      throw usageError(
        `Unknown field '${f}'. Available: ${pairs.map(([label]) => label).join(", ")}.`,
      );
    }
    picked.push(pair);
  }
  return picked;
}

export function renderTable<T>(
  rows: T[],
  columns: Column<T>[],
  opts: { color?: boolean; empty?: string } = {},
): string {
  const color = opts.color ?? false;
  const colors = pc.createColors(color);
  if (rows.length === 0) return colors.dim(sanitizeForTerminal(opts.empty ?? "(no results)"));

  const headers = columns.map((c) => c.header ?? c.key);
  const body = rows.map((row) => columns.map((c) => truncate(cell(c.value(row)), c.max ?? 60)));

  const widths = columns.map((_, i) => {
    const header = headers[i] ?? "";
    const colMax = body.reduce((m, r) => Math.max(m, displayWidth(r[i] ?? "")), 0);
    return Math.max(displayWidth(header), colMax);
  });

  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - displayWidth(s)));

  const headerLine = headers
    .map((h, i) => pad(colors.bold(h), widths[i] ?? 0))
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
  const colors = pc.createColors(color);
  const visible = pairs.filter(([, v]) => v !== undefined && v !== null);
  const keyWidth = visible.reduce((m, [k]) => Math.max(m, k.length), 0);
  return visible
    .map(([k, v]) => {
      const label = (k + ":").padEnd(keyWidth + 1);
      return `${colors.dim(label)} ${cell(v)}`;
    })
    .join("\n");
}
