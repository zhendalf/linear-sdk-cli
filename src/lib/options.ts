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
 * Register the global options shared by all commands on the root program.
 * Commander makes these inheritable via `cmd.optsWithGlobals()`.
 */
export function addGlobalOptions(program: Command): Command {
  return program
    .option("--json", "output machine-readable JSON")
    .option("--no-color", "disable colored output")
    .option("--api-key <key>", "Linear API key (overrides env/config)")
    .option("-t, --team <key>", "default team key (e.g. TES)")
    .option("-n, --limit <n>", "max results", parseIntOption)
    .option("--all", "fetch all results (exhaust pagination)")
    .option("-f, --fields <a,b,c>", "select output columns/fields", parseList)
    .option("-y, --yes", "skip confirmation prompts")
    .option("-q, --quiet", "suppress status output")
    .option("--no-input", "never prompt; fail instead")
    .option("--debug", "verbose errors (stack traces, raw GraphQL)");
}

/** Common issue-filter options reused by `issue list` and friends. */
export function addFilterOptions(cmd: Command): Command {
  return cmd
    .addOption(new Option("-s, --state <name>", "filter by workflow state name/type"))
    .addOption(new Option("-a, --assignee <who>", "filter by assignee (me|email|name)"))
    .addOption(new Option("-p, --project <name>", "filter by project"))
    .addOption(new Option("-l, --label <name>", "filter by label").argParser(parseList))
    .addOption(new Option("-P, --priority <0-4>", "filter by priority"))
    .addOption(new Option("--cycle <id>", "filter by cycle"))
    .addOption(new Option("--query <text>", "full-text search"))
    .addOption(new Option("--sort <field>", "sort order").choices(["priority", "updated", "created"]))
    .addOption(new Option("--include-archived", "include archived issues"));
}
