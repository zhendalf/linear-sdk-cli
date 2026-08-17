/**
 * Shared option helpers and parser functions for commander, so flags stay
 * consistent across the ~20 command groups.
 */

import { Command, Option } from "commander";
import { usageError, type CliError } from "./errors.js";

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

/**
 * A *complete* integer token.
 *
 * `Number.parseInt` stops at the first character it cannot use, so the previous
 * parser answered a different question than the user asked: `--priority 1.9`
 * became 1 and `--estimate 2junk` became 2, both silently. A flag value that is
 * not entirely an integer is a typo, and a typo should cost an error message,
 * not a wrong mutation.
 */
export function parseIntOption(value: string): number {
  if (!/^-?\d+$/.test(value)) throw usageError(`Expected an integer, got '${value}'`);
  return Number.parseInt(value, 10);
}

/**
 * Priority as Linear defines it: a complete integer in 0–4. The API does reject
 * out-of-range values on the round-trip, but locally is where it costs nothing,
 * and it makes issue/project priority behave like initiative priority, which
 * has validated locally all along (`resolvePriority` in services/initiative.ts —
 * the wording here matches deliberately, so the two cannot read as different
 * rules).
 */
export function parsePriority(value: string): number {
  const n = parseIntOption(value);
  if (n < 0 || n > 4)
    throw usageError(
      `Invalid priority '${value}'. Valid: 0 (none), 1 (urgent), 2 (high), 3 (medium), 4 (low).`,
    );
  return n;
}

/**
 * The filter spelling of `--priority`. Validates exactly like `parsePriority`
 * but hands back the canonical *string* the issue filter already consumes, so
 * the check lands at the CLI boundary without reshaping the service interface.
 */
function parsePriorityFilter(value: string): string {
  return String(parsePriority(value));
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

/**
 * The subcommand of `cmd` a mistyped `word` most plausibly meant, or nothing.
 *
 * Commander's own "did you mean" only fires on a command with no action
 * handler; the root has one (bare `linear` shows the branch's issue) and so does
 * `issue` (its default subcommand is `view`), so a stray word there used to be
 * reported as "too many arguments" or "not a valid issue id". Names and aliases
 * both count; a prefix (`proj` → `project`) or a small edit distance
 * (`issues` → `issue`, `lable` → `label`) is close enough, and the closest wins.
 */
export function suggestSubcommand(cmd: Command, word: string): string | undefined {
  const lower = word.toLowerCase();
  let best: { name: string; distance: number } | undefined;
  for (const sub of cmd.commands) {
    for (const candidate of [sub.name(), ...sub.aliases()]) {
      const c = candidate.toLowerCase();
      // A prefix is a match (`proj` → `project`). Otherwise up to one edit per
      // two characters, capped at three, so `lable` finds `label` — but never
      // against a two-letter alias, where one edit away is everything.
      let distance: number;
      if (lower.length >= 2 && c.startsWith(lower)) distance = 0;
      else if (c.length < 3) continue;
      else distance = editDistance(lower, c);
      if (distance > Math.min(3, Math.max(1, Math.floor(lower.length / 2)))) continue;
      if (!best || distance < best.distance) best = { name: sub.name(), distance };
    }
  }
  return best?.name;
}

/** A usage error for a word that names no subcommand of `cmd`, with the closest real one. */
export function unknownCommand(cmd: Command, word: string): CliError {
  const path = commandPath(cmd);
  const guess = suggestSubcommand(cmd, word);
  return usageError(
    `Unknown command '${word}'.${guess ? ` Did you mean '${guess}'?` : ""} Run '${path} --help' to see the commands.`,
  );
}

/** `linear issue` for the `issue` command — the way a user would type it. */
export function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (let c: Command | null = cmd; c; c = c.parent) names.unshift(c.name());
  return names.join(" ");
}

/** Levenshtein distance — small strings only (command names). */
function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
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
 * A `--no-…` global registered as an ordinary boolean flag rather than as
 * commander's *negation* of a positive option. Two bugs came out of leaving
 * these as negations, and neither is obvious from the flag's spelling:
 *
 *  1. **The storage key is shared.** Commander stores a negation under the name
 *     with `no-` stripped, so `--no-color` owns the attribute `color` — the very
 *     one the entity flag `--color <hex>` owns on labels, projects and roadmaps.
 *     `label create --name x --team TES --no-color` therefore put `color: false`
 *     into the mutation input and Linear rejected it: `Variable "$input" got
 *     invalid value false at "input.color"`. There was also no way to set an
 *     entity colour *and* turn off terminal colour, since one flag overwrote
 *     the other.
 *
 *  2. **A lone negation is seeded with a default of `true`** on every command it
 *     is registered on — including the root program — and `optsWithGlobals()`
 *     lets **ancestors overwrite descendants**. With `enablePositionalOptions()`
 *     the flag is parsed by the *sub*command, so the root's default `true` then
 *     overwrote the subcommand's explicit `false`. That is the second, deeper
 *     half of the dead `--no-input`: even reading `input === false` would have
 *     seen `true`, because by the time `Context` gets the merged options the
 *     `false` is gone.
 *
 * As a plain boolean neither happens: the key is ours to choose and cannot
 * collide with an entity field, and there is no default, so the key is simply
 * absent unless the user passed the flag — and an absent key cannot clobber
 * anything during the merge. Present ⇒ `true`, which is what the flag's own name
 * says it means.
 */
class NoFlagOption extends Option {
  private readonly key: string;
  constructor(flags: string, description: string, key?: string) {
    super(flags, description);
    // Opt out of commander's negation handling; see above.
    this.negate = false;
    this.key = key ?? super.attributeName();
  }
  override attributeName(): string {
    return this.key;
  }
}

/** The global option set, as fresh Option instances (they are per-command state). */
function globalOptions(): Option[] {
  return [
    new Option("-j, --json", "output machine-readable JSON"),
    new NoFlagOption("--no-ansi", "disable colored output"),
    // `--no-color` is the conventional spelling and stays supported everywhere,
    // including on the commands that own a `--color <hex>` of their own — which
    // is the entire point. It shares the canonical flag's key, so the two
    // spellings cannot drift apart.
    new NoFlagOption("--no-color", "alias of --no-ansi", "noAnsi").hideHelp(),
    new Option("--api-key <key>", "Linear API key (overrides env/config)"),
    new Option("--workspace <slug>", "select workspace credential profile"),
    new Option("-t, --team <key>", "default team key (e.g. TES)"),
    new Option("-n, --limit <n>", "max results (positive integer; 0 = all)").argParser(
      parsePositiveInt,
    ),
    new Option("--all", "fetch all results (exhaust pagination)"),
    new Option(
      "-f, --fields <a,b,c>",
      "select fields: table columns or detail lines (human), top-level keys (--json)",
    ).argParser(parseList),
    new Option("-y, --yes", "skip confirmation prompts"),
    new Option("-q, --quiet", "suppress status output"),
    new NoFlagOption("--no-input", "never prompt; fail instead"),
    new Option("--debug", "verbose errors (stack traces, raw GraphQL)"),
  ];
}

/**
 * The attribute names the globals are stored under (`json`, `noAnsi`, `limit`,
 * …), deduplicated — `--no-color` shares `noAnsi` with `--no-ansi` by design.
 * The error boundary reads these back off the parsed command tree.
 */
export function globalOptionKeys(): string[] {
  return [...new Set(globalOptions().map((option) => option.attributeName()))];
}

/**
 * Register the global options shared by all commands, on the root program and
 * (via `applyGlobalOptionsToAll` in cli.ts) on every subcommand, so they work in
 * any position. Commander makes them inheritable via `cmd.optsWithGlobals()`.
 *
 * A command that has already registered its own version of a global keeps it:
 * `issue list`/`mine`/`search` declare a **repeatable** `--team` (several teams
 * in one query), and re-adding the single-valued global on top of it would
 * silently take the last key instead of collecting them.
 */
export function addGlobalOptions(program: Command): Command {
  for (const option of globalOptions()) {
    if (program.options.some((existing) => existing.long === option.long)) continue;
    program.addOption(option);
  }
  return program;
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
 *
 * `--team` and `--state` are **repeatable here only**. `--team` is a global
 * option used by ~135 commands for far more than filtering (it is the team an
 * issue is created in, the team a cycle belongs to, …), where "several teams"
 * has no meaning; making the global itself a list would push an array through
 * every one of those call sites. So the queries — the only commands where a
 * multi-team answer is well-defined — declare their own repeatable `--team`,
 * and `addGlobalOptions` leaves it alone. Repeating either flag BROADENS, unlike
 * `--label`: an issue belongs to exactly one team and sits in exactly one state,
 * so narrowing would be a filter that can never match.
 */
export function addCoreFilterOptions(cmd: Command, set: FilterOptionSet = {}): Command {
  cmd.addOption(
    new Option("-t, --team <key>", "filter by team key (repeatable; default: configured team)").argParser(
      collectArray,
    ),
  );
  cmd.addOption(
    new Option("-s, --state <name>", "filter by workflow state name/type (repeatable)").argParser(
      collectArray,
    ),
  );
  if (set.assignee !== false) {
    cmd.addOption(new Option("-a, --assignee <who>", "filter by assignee (me|email|name)"));
    cmd.addOption(new Option("-U, --unassigned", "only issues with no assignee"));
  }
  return cmd
    .addOption(new Option("-p, --project <name>", "filter by project"))
    .addOption(
      new Option("--project-label <name>", "filter by the project's label (excludes --project)"),
    )
    .addOption(new Option("--milestone <name>", "filter by project milestone"))
    .addOption(new Option("-l, --label <name>", "filter by label (repeat to narrow)").argParser(parseList))
    .addOption(new Option("-P, --priority <0-4>", "filter by priority").argParser(parsePriorityFilter))
    .addOption(new Option(CYCLE_FLAG, CYCLE_DESC))
    .addOption(new Option("--created-after <date>", "only issues created at/after a date (YYYY-MM-DD)"))
    .addOption(new Option("--updated-after <date>", "only issues updated at/after a date (YYYY-MM-DD)"))
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
