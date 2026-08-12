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
 * Strict positive-integer parser for `--limit`: accepts only `1`, `2`, … (no
 * leading zeros, no trailing junk, no `0`). Rejects `0`, `-1`, `12x`, `1.5`
 * with a clear usage error instead of silently falling back.
 */
export function parsePositiveInt(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw usageError(`Expected --limit to be a positive integer, got '${value}'.`);
  }
  return Number.parseInt(value, 10);
}

/** Shared metavar + help for the cycle option (filter + create/update). */
export const CYCLE_FLAG = "--cycle <n>";
export const CYCLE_DESC = "cycle number, id, or 'current'";

/**
 * Register the global options shared by all commands on the root program.
 * Commander makes these inheritable via `cmd.optsWithGlobals()`.
 */
export function addGlobalOptions(program: Command): Command {
  return program
    .option("--json", "output machine-readable JSON")
    .option("--no-color", "disable colored output")
    .option("--api-key <key>", "Linear API key (overrides env/config)")
    .option("--workspace <slug>", "select workspace credential profile")
    .option("-t, --team <key>", "default team key (e.g. TES)")
    .option("-n, --limit <n>", "max results (positive integer)", parsePositiveInt)
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
  return addCoreFilterOptions(cmd, set)
    .addOption(new Option("--query <text>", "full-text search"))
    .addOption(new Option("--sort <field>", "sort order").choices(["priority", "updated", "created"]));
}
