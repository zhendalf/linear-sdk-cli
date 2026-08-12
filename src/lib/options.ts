/**
 * Shared option helpers and parser functions for commander, so flags stay
 * consistent across the ~20 command groups.
 */

import { Command, Option } from "commander";
import { usageError } from "./errors.js";

/** Repeatable `--var k=v` collector → { k: v }. */
export function collectKeyVal(value: string, previous: Record<string, string> = {}): Record<string, string> {
  const eq = value.indexOf("=");
  if (eq === -1) throw usageError(`Expected key=value, got '${value}'`);
  const key = value.slice(0, eq);
  previous[key] = value.slice(eq + 1);
  return previous;
}

/** Repeatable string collector → string[]. */
export function collectArray(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}

/** Comma-or-repeat list parser used by --fields and --label. */
export function parseList(value: string, previous: string[] = []): string[] {
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (trimmed) previous.push(trimmed);
  }
  return previous;
}

export function parseIntOption(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw usageError(`Expected an integer, got '${value}'`);
  return n;
}

/**
 * Strict count parser for `--limit`: accepts `1`, `2`, … plus the single
 * special value `0`, which the reference CLI spells as "no limit" and which we
 * map onto `--all` (see `Context.limit`). Rejects `-1`, `12x`, `1.5` and
 * leading zeros with a clear usage error instead of silently falling back.
 */
export function parsePositiveInt(value: string): number {
  if (value === "0") return 0;
  if (!/^[1-9]\d*$/.test(value)) {
    throw usageError(`Expected --limit to be a positive integer (or 0 for all), got '${value}'.`);
  }
  return Number.parseInt(value, 10);
}

/** Shared metavar + help for the cycle option (filter + create/update). */
export const CYCLE_FLAG = "--cycle <n>";
export const CYCLE_DESC = "cycle number, name, id, or 'current'";

// --- Long-flag aliases -----------------------------------------------------
//
// The reference CLI spells several of our flags differently (`--due-date` for
// `--due`, `--search` for `--query`, …). We accept both spellings so a
// transplanted script keeps working, with one mechanism used everywhere:
//
//   1. the alias is registered as a *hidden* option, so `--help` and
//      `linear commands --json` keep showing exactly one canonical spelling
//      each and don't double in size;
//   2. the action reads it through `readAlias`, which errors when BOTH
//      spellings are passed rather than silently preferring one.
//
// Every alias is listed in README's "Coming from linear-cli" table.

/** `"--due-date <date>"` → `"dueDate"`, matching commander's opts key. */
function optionKey(flags: string): string {
  const long = flags.split(/[ ,|]+/).find((f) => f.startsWith("--"));
  if (!long) throw new Error(`No long flag in '${flags}'`);
  return long.replace(/^--/, "").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Register `flags` as a hidden alias of the already-registered `canonical`
 * option on `cmd`. Read the pair back with `readAlias`.
 */
export function addAliasOption(cmd: Command, flags: string, canonical: string): Command {
  return cmd.addOption(new Option(flags, `alias of ${canonical}`).hideHelp());
}

/**
 * Read an option that may have been given under either spelling.
 *
 * Rule: passing both spellings at once is a usage error. Neither wins by
 * default — quietly preferring one would hide a real mistake (`--due 2026-01-01
 * --due-date 2026-02-01` is not a typo we should guess at).
 */
export function readAlias<T = string>(
  opts: Record<string, any>,
  canonical: string,
  alias: string,
): T | undefined {
  const canonicalValue = opts[optionKey(canonical)];
  const aliasValue = opts[optionKey(alias)];
  if (canonicalValue !== undefined && aliasValue !== undefined) {
    throw usageError(`Pass either ${canonical} or ${alias}, not both.`);
  }
  return (canonicalValue ?? aliasValue) as T | undefined;
}

/**
 * Register the global options shared by all commands on the root program.
 * Commander makes these inheritable via `cmd.optsWithGlobals()`.
 */
export function addGlobalOptions(program: Command): Command {
  return program
    .option("-j, --json", "output machine-readable JSON")
    .option("--no-color", "disable colored output")
    .option("--api-key <key>", "Linear API key (overrides env/config)")
    .option("--workspace <slug>", "select workspace credential profile")
    .option("-t, --team <key>", "default team key (e.g. TES)")
    .option("-n, --limit <n>", "max results (positive integer; 0 = all)", parsePositiveInt)
    .option("--all", "fetch all results (exhaust pagination)")
    .option("-f, --fields <a,b,c>", "select columns for human table output", parseList)
    .option("-y, --yes", "skip confirmation prompts")
    .option("-q, --quiet", "suppress status output")
    .option("--no-input", "never prompt; fail instead")
    .option("--debug", "verbose errors (stack traces, raw GraphQL)");
}

/** Opt-outs for the shared filter sets; `issue mine` is fixed to the viewer. */
export interface FilterOptionSet {
  /** Register `-a, --assignee`. Off for `issue mine`, whose assignee is you. */
  assignee?: boolean;
}

/**
 * Issue filters shared by `issue list`, `issue search`, and `issue mine`. All
 * narrow to the default team unless `--all-teams` widens them back to the whole
 * workspace. Repeating `--label` narrows (the issue must carry every label).
 */
export function addCoreFilterOptions(cmd: Command, set: FilterOptionSet = {}): Command {
  cmd.addOption(new Option("-s, --state <name>", "filter by workflow state name/type"));
  if (set.assignee !== false) {
    cmd.addOption(new Option("-a, --assignee <who>", "filter by assignee (me|email|name)"));
  }
  return cmd
    .addOption(new Option("-p, --project <name>", "filter by project"))
    .addOption(new Option("-l, --label <name>", "filter by label (repeat to narrow)").argParser(parseList))
    .addOption(new Option("-P, --priority <0-4>", "filter by priority"))
    .addOption(new Option(CYCLE_FLAG, CYCLE_DESC))
    .addOption(new Option("--all-teams", "search every team, ignoring the default team"))
    .addOption(new Option("--include-archived", "include archived issues"));
}

/**
 * `issue list` / `issue mine` filters: the shared set plus full-text and sort,
 * neither of which applies to `issue search` (the term *is* the text, and search
 * is relevance-ordered).
 */
export function addFilterOptions(cmd: Command, set: FilterOptionSet = {}): Command {
  addCoreFilterOptions(cmd, set)
    .addOption(new Option("--query <text>", "full-text search"))
    .addOption(new Option("--sort <field>", "sort order").choices(["priority", "updated", "created"]));
  // `--search` is the reference CLI's spelling of the same filter.
  return addAliasOption(cmd, "--search <text>", "--query");
}
