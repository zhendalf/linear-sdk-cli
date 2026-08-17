/**
 * The vocabulary `linear commands --json` uses to say what a command's `--json`
 * output looks like, so an agent driving the CLI cold knows that a list row has
 * `.state.name` and a detail has `.team.key` before it runs anything (TES-610).
 *
 * A shape is a JSON value:
 *   - a scalar type name:      "string" | "number" | "boolean" | "unknown" | "object",
 *     or the same with `|null` ("string|null") when the value may be null;
 *   - an object:               { key: <shape>, ... } — exactly these keys, never null.
 *     A key ending in `?` ("comments?") may be absent; every other key is always present;
 *   - an array:                [ <shape> ] — one element, the type of every item;
 *   - a nullable object/array: { "nullable": <shape> } — the wrapped shape, or null.
 *
 * "unknown" is a JSON value this CLI passes through unchanged; "object" is a
 * map with data-dependent keys.
 *
 * The row/detail shapes are declared next to the TypeScript interfaces they
 * describe, through `shape<T>()`, whose parameter type `ShapeOf<T>` is computed
 * from the interface: a renamed, added, removed, re-typed or de-nulled field is
 * a compile error in the shape constant, so the description cannot quietly
 * drift from the type the service returns. `matchesShape` is the runtime half —
 * the tests hold real emitted objects against the declared shapes, which is
 * what catches a field the interface promises but the query stopped selecting.
 */

export type ScalarShape = "string" | "number" | "boolean" | "unknown" | "object";

export type FieldShape =
  | ScalarShape
  | `${ScalarShape}|null`
  | readonly [FieldShape]
  | { readonly nullable: FieldShape }
  | { readonly [key: string]: FieldShape };

/** How a command's `--json` stdout is shaped. */
export interface OutputShape {
  /**
   * list    — a bare array of `fields`-shaped rows
   * object  — a bare object with `fields` (a `view`, `whoami`, `config show`, …)
   * receipt — a mutation's bare object with `fields` (ids + what happened)
   * raw     — pass-through JSON whose keys depend on the request (`api`, `schema`)
   * none    — the command never prints JSON (`completion`)
   */
  kind: "list" | "object" | "receipt" | "raw" | "none";
  fields?: Record<string, FieldShape>;
  /** What the fields cannot say. */
  note?: string;
  /**
   * A different output under a flag or argument, keyed by what selects it
   * (`"--web"`, `"op=list"`, `"[path]"`): the whole shape printed in that case.
   */
  variants?: Record<string, OutputShape>;
}

// ---------------------------------------------------------------------------
// ShapeOf<T>: the shape a TypeScript type must be described as.
// ---------------------------------------------------------------------------

type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * The object form of a non-null object type: every key, an optional or
 * `undefined`-able one spelled with a trailing `?` (it may be absent from the
 * JSON — `undefined` is dropped by JSON.stringify — which is not the same as null).
 */
type ObjectShapeOf<T> = string extends keyof T
  ? "object"
  : {
      [K in keyof T as IsAny<T[K]> extends true
        ? K & string
        : undefined extends T[K]
          ? `${K & string}?`
          : K & string]-?: ShapeOf<Exclude<T[K], undefined>>;
    };

export type ShapeOf<T> =
  IsAny<T> extends true
    ? "unknown"
    : [T] extends [string]
      ? "string"
      : [T] extends [number]
        ? "number"
        : [T] extends [boolean]
          ? "boolean"
          : [T] extends [Date]
            ? "string"
            : [T] extends [string | null]
              ? "string|null"
              : [T] extends [number | null]
                ? "number|null"
                : [T] extends [boolean | null]
                  ? "boolean|null"
                  : [T] extends [Date | null]
                    ? "string|null"
                    : [T] extends [readonly (infer E)[]]
                      ? readonly [ShapeOf<E>]
                      : [T] extends [readonly (infer E)[] | null]
                        ? { readonly nullable: readonly [ShapeOf<E>] }
                        : [T] extends [object]
                          ? ObjectShapeOf<T>
                          : [T] extends [object | null]
                            ? { readonly nullable: ObjectShapeOf<NonNullable<T>> }
                            : "unknown";

/**
 * Declare the shape of `T`. The argument is checked against `ShapeOf<T>`, so
 * it must name every field of `T` with the right type and nothing else.
 */
export function shape<T>(s: ShapeOf<T>): ShapeOf<T> {
  return s;
}

/** The fields of an object shape (a `ShapeOf<Interface>`), for `OutputShape.fields`. */
export type ObjectFields = Record<string, FieldShape>;

// ---------------------------------------------------------------------------
// Runtime: check a real value against a shape, and render a shape for humans.
// ---------------------------------------------------------------------------

function isNullableWrapper(s: FieldShape): s is { readonly nullable: FieldShape } {
  return (
    typeof s === "object" &&
    !Array.isArray(s) &&
    Object.keys(s).length === 1 &&
    "nullable" in s
  );
}

/**
 * Every way `value` fails to be a `shape`, as `path: problem` strings; empty
 * when it matches. Objects must carry exactly the declared keys: an extra key
 * is as much a drift as a missing one (it is a key the docs do not mention),
 * and a missing non-optional key is a drift even when its type allows null —
 * `undefined` vanishes from JSON, so the documented key would not be there.
 *
 * `strictNullable` also flags a `{ nullable: … }` field that IS null. The
 * sweep uses it: its fake answers every relation, so a relation that still
 * comes out null was not selected or not mapped — a `?? null` in a mapper hides
 * exactly the drift TES-652 was.
 */
export function matchesShape(
  value: unknown,
  shape: FieldShape,
  path = "$",
  strictNullable = false,
): string[] {
  if (typeof shape === "string") {
    const [base, nullable] = shape.endsWith("|null")
      ? [shape.slice(0, -"|null".length) as ScalarShape, true]
      : [shape as ScalarShape, false];
    if (value === undefined) return [`${path}: expected ${shape}, got undefined`];
    if (value === null) return nullable ? [] : [`${path}: expected ${shape}, got null`];
    if (base === "unknown") return [];
    if (base === "object") {
      return typeof value === "object" && !Array.isArray(value)
        ? []
        : [`${path}: expected an object, got ${describe(value)}`];
    }
    return typeof value === base ? [] : [`${path}: expected ${shape}, got ${describe(value)}`];
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return [`${path}: expected an array, got ${describe(value)}`];
    return value.flatMap((item, i) => matchesShape(item, shape[0], `${path}[${i}]`, strictNullable));
  }
  if (isNullableWrapper(shape)) {
    if (value === undefined) return [`${path}: expected an object or null, got undefined`];
    if (value === null) {
      return strictNullable ? [`${path}: null, although the source answers every relation`] : [];
    }
    return matchesShape(value, shape.nullable, path, strictNullable);
  }
  // A plain object shape.
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [`${path}: expected an object, got ${describe(value)}`];
  }
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  const declared = new Set<string>();
  for (const [spelled, sub] of Object.entries(shape)) {
    const optional = spelled.endsWith("?");
    const key = optional ? spelled.slice(0, -1) : spelled;
    declared.add(key);
    if (optional && record[key] === undefined) continue;
    problems.push(...matchesShape(record[key], sub, `${path}.${key}`, strictNullable));
  }
  for (const key of Object.keys(record)) {
    if (!declared.has(key) && record[key] !== undefined) problems.push(`${path}.${key}: not in the declared shape`);
  }
  return problems;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

/**
 * A shape as one TypeScript-ish line: `{id: string, state: {name: string, type:
 * string} | null, labels: string[]}` — the human rendering in `linear commands`.
 */
export function renderShape(shape: FieldShape): string {
  if (typeof shape === "string") return shape.replace("|null", " | null");
  if (Array.isArray(shape)) {
    const inner = renderShape(shape[0]);
    return typeof shape[0] === "string" && !shape[0].includes("|") ? `${inner}[]` : `Array<${inner}>`;
  }
  if (isNullableWrapper(shape)) return `${renderShape(shape.nullable)} | null`;
  const parts = Object.entries(shape).map(([k, v]) => `${k}: ${renderShape(v)}`);
  return `{${parts.join(", ")}}`;
}

/**
 * A variant that is its base plus some keys (`issue view --comments`, `issue
 * create --start`) is best shown as the difference: the keys it adds or
 * re-types, and whether it drops any. Returns null when the two are unrelated
 * (a different kind, or fewer than half the base keys kept), in which case the
 * variant is shown in full.
 */
export function variantDelta(
  base: OutputShape,
  variant: OutputShape,
): { added: Record<string, FieldShape>; dropped: string[] } | null {
  if (base.kind !== variant.kind || !base.fields || !variant.fields) return null;
  const same = (a: FieldShape, b: FieldShape) => JSON.stringify(a) === JSON.stringify(b);
  const kept = Object.keys(base.fields).filter(
    (k) => k in variant.fields! && same(base.fields![k]!, variant.fields![k]!),
  );
  if (kept.length < Object.keys(base.fields).length / 2) return null;
  const added: Record<string, FieldShape> = {};
  for (const [k, v] of Object.entries(variant.fields)) {
    if (!(k in base.fields) || !same(base.fields[k]!, v)) added[k] = v;
  }
  const dropped = Object.keys(base.fields).filter((k) => !(k in variant.fields!));
  return { added, dropped };
}

/** The lines `linear commands <path>` prints under "Output (--json)". */
export function renderOutputShape(out: OutputShape, indent = "  "): string[] {
  const head =
    out.kind === "list"
      ? "array of objects:"
      : out.kind === "object"
        ? "object:"
        : out.kind === "receipt"
          ? "receipt object:"
          : out.kind === "raw"
            ? "raw JSON (keys depend on the request)"
            : "none (never prints JSON)";
  const lines = [head];
  for (const [key, sub] of Object.entries(out.fields ?? {})) {
    lines.push(`${indent}${key}: ${renderShape(sub)}`);
  }
  if (out.note) lines.push(`${indent}(${out.note})`);
  for (const [when, variant] of Object.entries(out.variants ?? {})) {
    const delta = variantDelta(out, variant);
    if (delta) {
      const drop = delta.dropped.length ? `, without ${delta.dropped.join(", ")}` : "";
      lines.push(`${indent}with ${when}: the same${drop}, plus:`);
      for (const [key, sub] of Object.entries(delta.added)) {
        lines.push(`${indent}  ${key}: ${renderShape(sub)}`);
      }
      continue;
    }
    const [vHead, ...vRest] = renderOutputShape(variant, indent + "  ");
    lines.push(`${indent}with ${when}: ${vHead}`, ...vRest);
  }
  return lines;
}
