/**
 * Resolve friendly human inputs into the IDs the SDK needs.
 *
 * These are the ergonomics layer: `TES` → team id, `me`/email → user id, a
 * state name → state id, label names → ids, `TES-123` → the Issue, etc. Every
 * resolver throws a CliError (not_found/ambiguous) with a helpful message.
 */

import type { LinearClient, Issue } from "@linear/sdk";
import { withRetry } from "../client.js";
import { notFound, ambiguous, usageError } from "./errors.js";
import { collectWithMore, type Connection } from "./pagination.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string): boolean => UUID_RE.test(v);

const IDENTIFIER_RE = /^([a-zA-Z][a-zA-Z0-9]*)-(\d+)$/;

/** Known workflow-state types, used to decide name-vs-type filtering. */
export const STATE_TYPES = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];

/**
 * Page size and hard bound for the resolvers that match a name client-side.
 *
 * Those resolvers used to ask for a fixed `first: 100`/`first: 250` and match
 * within whatever came back, so on a large workspace a team/state/cycle/
 * milestone that existed past the cap resolved to a false `not_found` — and an
 * ambiguity check only ever considered a prefix of the candidates. They now
 * follow the connection instead.
 *
 * 250 is Linear's per-page maximum, so the common workspace still costs exactly
 * the one request it always did; the extra requests are paid only by the
 * workspaces that actually have more than 250 of something. The scan is bounded
 * at 2000 (8 requests) rather than being unbounded: past that, guessing at a
 * name is not the right tool, and the error says so instead of quietly
 * truncating.
 */
const RESOLVE_PAGE = 250;
const RESOLVE_SCAN_CAP = 2000;

/** How many candidate names an error message will list before pointing at a command. */
const MAX_LISTED = 25;

/**
 * Follow a connection to the end (bounded), for a resolver that has to match
 * client-side. Hitting the bound is an honest error, not a silent prefix.
 */
async function scanAll<T>(conn: Connection<T>, plural: string, discovery: string): Promise<T[]> {
  const { items, hasMore } = await collectWithMore(conn, RESOLVE_SCAN_CAP);
  if (hasMore) {
    throw usageError(
      `More than ${RESOLVE_SCAN_CAP} ${plural} to search; pass the id instead (see '${discovery}').`,
    );
  }
  return items;
}

/**
 * The tail of a not-found message: the candidates when the set is small enough
 * to be useful, otherwise the command that lists them. Both are free — the
 * candidates are already in hand, and no message here costs a round-trip.
 */
function available(names: Array<string | null | undefined>, discovery: string): string {
  const shown = names.filter((n): n is string => !!n);
  if (shown.length === 0) return ` None to choose from (see '${discovery}').`;
  if (shown.length > MAX_LISTED) return ` Run '${discovery}' to see the ${shown.length} options.`;
  return ` Available: ${shown.join(", ")}.`;
}

export interface ResolvedTeam {
  id: string;
  key: string;
  name: string;
}

/** Resolve a team by key (preferred), name, or id. Falls back to `fallbackKey`. */
export async function resolveTeam(
  client: LinearClient,
  input: string | undefined,
  fallbackKey: string | undefined,
): Promise<ResolvedTeam> {
  const value = input ?? fallbackKey;
  if (!value) {
    throw usageError("No team specified. Pass --team <KEY> or set a default team in config.");
  }
  if (isUuid(value)) {
    const team = await withRetry(() => client.team(value));
    return { id: team.id, key: team.key, name: team.name };
  }
  const conn = await withRetry(() => client.teams({ first: RESOLVE_PAGE }));
  const nodes = await scanAll<any>(conn as any, "teams", "linear team list");
  const lower = value.toLowerCase();
  const byKey = nodes.filter((t: any) => t.key.toLowerCase() === lower);
  const matches: any[] = byKey.length
    ? byKey
    : nodes.filter((t: any) => t.name.toLowerCase() === lower);
  if (matches.length === 0)
    throw notFound(
      `No team matching '${value}'.${available(
        nodes.map((t: any) => t.key),
        "linear team list",
      )}`,
    );
  if (matches.length > 1) throw ambiguous(`Multiple teams match '${value}': ${matches.map((t) => t.key).join(", ")}`);
  const team = matches[0]!;
  return { id: team.id, key: team.key, name: team.name };
}

/** The spellings that mean "the authenticated user": ours (`me`, `@me`) and the reference CLI's (`self`). */
export const isSelf = (input: string): boolean => input === "me" || input === "@me" || input === "self";

/**
 * Resolve an assignee reference (`me`, email, name, or id) to a user id.
 *
 * `self` is the reference CLI's spelling of the same sentinel; it is accepted
 * alongside `me`/`@me` so transplanted commands assign to the viewer instead of
 * failing to find a user literally named "self".
 */
export async function resolveUserId(client: LinearClient, input: string): Promise<string> {
  if (isSelf(input)) {
    const me = await withRetry(() => client.viewer);
    return me.id;
  }
  if (isUuid(input)) return input;
  const isEmail = input.includes("@");
  const filter = isEmail ? { email: { eq: input } } : { displayName: { eqIgnoreCase: input } };
  const lookup = async (f: any) =>
    scanAll(
      (await withRetry(() => client.users({ filter: f, first: RESOLVE_PAGE }))) as any,
      "users",
      "linear user list",
    );
  let nodes: any[] = await lookup(filter);
  if (nodes.length === 0 && !isEmail) nodes = await lookup({ name: { eqIgnoreCase: input } });
  // The candidate set here is a server-side exact match, so there is nothing
  // useful to list on a miss — point at the command that would show it instead
  // of spending a round-trip on error text.
  if (nodes.length === 0)
    throw notFound(`No user matching '${input}'. Run 'linear user list' to see workspace members.`);
  if (nodes.length > 1)
    throw ambiguous(`Multiple users match '${input}': ${nodes.map((u: any) => u.email).join(", ")}`);
  return nodes[0]!.id;
}

/** Resolve a workflow state (by name or type) within a team to a state id. */
export async function resolveStateId(
  client: LinearClient,
  teamId: string,
  input: string,
): Promise<string> {
  if (isUuid(input)) return input;
  const nodes = await teamStates(client, teamId);
  const lower = input.toLowerCase();
  const byName = nodes.filter((s: any) => s.name.toLowerCase() === lower);
  const matches: any[] = byName.length
    ? byName
    : nodes.filter((s: any) => s.type.toLowerCase() === lower);
  if (matches.length === 0)
    throw notFound(
      `No workflow state '${input}' in team.${available(
        nodes.map((s: any) => s.name),
        "linear state list",
      )}`,
    );
  if (matches.length > 1)
    throw ambiguous(`Multiple states match '${input}': ${matches.map((s) => s.name).join(", ")}`);
  return matches[0]!.id;
}

/** Every workflow state in a team, following the connection past the first page. */
async function teamStates(client: LinearClient, teamId: string): Promise<any[]> {
  const team = await withRetry(() => client.team(teamId));
  const conn = await withRetry(() => team.states({ first: RESOLVE_PAGE }));
  return scanAll<any>(conn as any, "workflow states", "linear state list");
}

/**
 * Resolve label names to ids. When `teamId` is given, labels are matched within
 * that team's scope plus workspace-level (team-less) labels, and ambiguity is an
 * error — important in multi-team workspaces where the same name exists twice.
 */
export async function resolveLabelIds(
  client: LinearClient,
  names: string[],
  teamId?: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    if (isUuid(name)) {
      ids.push(name);
      continue;
    }
    const conn = await withRetry(() =>
      client.issueLabels({ filter: { name: { eqIgnoreCase: name } } as any, first: RESOLVE_PAGE }),
    );
    // Scanned rather than capped: the team narrowing below can discard every
    // label on the first page, so a fixed page cap could turn a label that
    // exists into a not-found.
    const nodes = await scanAll<any>(conn as any, "labels", "linear label list");
    if (nodes.length === 0)
      throw notFound(`No label matching '${name}'. Run 'linear label list' to see the options.`);

    // Narrow to this team's labels + workspace-level labels when a team is known.
    // If a team is known and nothing is in scope, that's not-found (do NOT fall
    // back to an out-of-scope label from another team).
    let candidates: any[] = nodes;
    if (teamId) {
      const scoped = await Promise.all(
        nodes.map(async (l: any) => ({ label: l, team: await l.team })),
      );
      candidates = scoped.filter((s) => !s.team || s.team.id === teamId).map((s) => s.label);
      if (candidates.length === 0) throw notFound(`No label '${name}' in this team or workspace.`);
    }

    // Prefer an exact (case-sensitive) match.
    const exact = candidates.filter((l: any) => l.name === name);
    const finalists = exact.length ? exact : candidates;
    if (finalists.length > 1) {
      throw ambiguous(
        `Multiple labels named '${name}'${teamId ? " in scope" : ""}; pass the label id instead.`,
      );
    }
    ids.push(finalists[0]!.id);
  }
  return ids;
}

/**
 * Resolve initiative label names to ids. Initiative labels are their own
 * workspace-scoped entity (`initiativeLabels`, public since @linear/sdk 88.2) —
 * unrelated to issue labels, and with no team scoping to narrow by.
 *
 * Label *groups* (`isGroup`) are containers, not applicable labels, so they are
 * excluded from matching.
 */
export async function resolveInitiativeLabelIds(
  client: LinearClient,
  names: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    if (isUuid(name)) {
      ids.push(name);
      continue;
    }
    const conn: any = await withRetry(() =>
      (client as any).initiativeLabels({
        filter: { name: { eqIgnoreCase: name } },
        first: RESOLVE_PAGE,
      }),
    );
    const nodes = await scanAll<any>(conn, "initiative labels", "linear initiative label list");
    const candidates = nodes.filter((l) => !l.isGroup);
    if (candidates.length === 0)
      throw notFound(
        `No initiative label matching '${name}'. Run 'linear initiative label list' to see the options.`,
      );

    // Prefer an exact (case-sensitive) match before declaring ambiguity.
    const exact = candidates.filter((l) => l.name === name);
    const finalists = exact.length ? exact : candidates;
    if (finalists.length > 1)
      throw ambiguous(`Multiple initiative labels named '${name}'; pass the label id instead.`);
    ids.push(finalists[0]!.id);
  }
  return ids;
}

/**
 * Resolve project label names to ids. Like initiative labels, project labels are
 * a workspace-scoped entity of their own (`projectLabels`), and label *groups*
 * are containers rather than applicable labels, so they are excluded.
 */
export async function resolveProjectLabelIds(
  client: LinearClient,
  names: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    if (isUuid(name)) {
      ids.push(name);
      continue;
    }
    const conn: any = await withRetry(() =>
      (client as any).projectLabels({
        filter: { name: { eqIgnoreCase: name } },
        first: RESOLVE_PAGE,
      }),
    );
    const nodes = await scanAll<any>(conn, "project labels", "linear project label list");
    const candidates = nodes.filter((l) => !l.isGroup);
    if (candidates.length === 0)
      throw notFound(
        `No project label matching '${name}'. Run 'linear project label list' to see the options.`,
      );

    const exact = candidates.filter((l) => l.name === name);
    const finalists = exact.length ? exact : candidates;
    if (finalists.length > 1)
      throw ambiguous(`Multiple project labels named '${name}'; pass the label id instead.`);
    ids.push(finalists[0]!.id);
  }
  // The same label named twice (or by name and id) must not be sent twice.
  return [...new Set(ids)];
}

/** First workflow state of a given type (lowest position) within a team. */
export async function firstStateOfType(
  client: LinearClient,
  teamId: string,
  type: string,
): Promise<string> {
  const nodes = await teamStates(client, teamId);
  const ofType = nodes
    .filter((s: any) => s.type === type)
    .sort((a: any, b: any) => a.position - b.position);
  if (ofType.length === 0)
    throw notFound(
      `No '${type}' workflow state in this team.${available(
        [...new Set(nodes.map((s: any) => s.type as string))],
        "linear state list",
      )}`,
    );
  return ofType[0]!.id;
}

/** Resolve a project by name or id. */
export async function resolveProjectId(client: LinearClient, input: string): Promise<string> {
  if (isUuid(input)) return input;
  const conn = await withRetry(() =>
    client.projects({ filter: { name: { eqIgnoreCase: input } } as any, first: RESOLVE_PAGE }),
  );
  const nodes = await scanAll<any>(conn as any, "projects", "linear project list");
  if (nodes.length === 0)
    throw notFound(`No project matching '${input}'. Run 'linear project list' to see the options.`);
  if (nodes.length > 1)
    throw ambiguous(`Multiple projects match '${input}': ${nodes.map((p: any) => p.name).join(", ")}`);
  return nodes[0]!.id;
}

/** The reserved cycle words, so help text and tests share one list. */
export const CYCLE_SENTINELS = ["current", "active", "now", "next", "previous"] as const;

/** A whole-token integer: the only shape that means "cycle number". */
const CYCLE_NUMBER_RE = /^\d+$/;
/** A signed offset from the active cycle: `+1`, `-2`. */
const CYCLE_OFFSET_RE = /^[+-]\d+$/;

/**
 * Resolve a cycle within a team by number, name, id, a sentinel, or an offset.
 *
 * The union of both CLIs' vocabularies, plus the reference's 2.2 relative
 * references:
 *
 *  - `current` / `active` / `now` — the team's active cycle
 *  - `next` / `previous` — the cycle Linear flags `isNext` / `isPrevious`
 *  - `+N` / `-N` — N cycles after / before the active one, by cycle number
 *  - a whole-token integer — that cycle number
 *  - anything else — a cycle *name*, matched case-insensitively
 *
 * Reserved words win over coincidental cycle names; a cycle literally named
 * "next" is reachable by number or id.
 *
 * Only a *complete* integer token is a number. `Number.parseInt` used to decide
 * this, so `--cycle 3.9` and `--cycle 3abc` quietly resolved to cycle #3 (and
 * `issue update` moved the issue there), while a cycle *named* with a leading
 * digit — `2024 Q1`, `24W03` — could never be reached by name at all, because it
 * parsed as #2024 first.
 */
export async function resolveCycleId(
  client: LinearClient,
  teamId: string,
  input: string,
): Promise<string> {
  if (isUuid(input)) return input;
  const team = await withRetry(() => client.team(teamId));
  // Only an explicit `false` — the fakes in unit tests (and any partial model)
  // leave the field undefined, and the API rejects nothing on `undefined`.
  if ((team as any).cyclesEnabled === false) {
    throw usageError(
      `Cycles are not enabled for team ${team.key ?? teamId}. Enable them in Linear's team settings before assigning or filtering by cycle.`,
    );
  }
  const keyword = input.toLowerCase();

  if (keyword === "current" || keyword === "active" || keyword === "now") {
    const cycle = await team.activeCycle;
    if (!cycle)
      throw notFound("No active cycle for this team. Try 'next', a cycle number, or a cycle name.");
    return cycle.id;
  }

  if (keyword === "next" || keyword === "previous") {
    // Linear computes these flags server-side relative to the active cycle, so
    // the lookup is one filtered request rather than a scan and a guess.
    const flag = keyword === "next" ? "isNext" : "isPrevious";
    const cycles = await withRetry(() =>
      team.cycles({ filter: { [flag]: { eq: true } } as any, first: 1 }),
    );
    if (cycles.nodes.length === 0)
      throw notFound(`No ${keyword} cycle for this team. Use a cycle number or name instead.`);
    return cycles.nodes[0]!.id;
  }

  if (CYCLE_OFFSET_RE.test(input)) {
    const offset = Number(input);
    if (!Number.isSafeInteger(offset)) throw usageError(`Cycle offset '${input}' is out of range.`);
    const active = await team.activeCycle;
    if (!active)
      throw notFound(
        `Cannot resolve relative cycle '${input}': the team has no active cycle. Use 'next', a cycle number, or a cycle name instead.`,
      );
    const target = active.number + offset;
    if (target < 1)
      throw notFound(`No cycle ${input} from the active cycle (#${active.number}) in this team.`);
    return cycleByNumber(team, target, `${input} (cycle #${target})`);
  }

  if (CYCLE_NUMBER_RE.test(input)) {
    return cycleByNumber(team, Number.parseInt(input, 10), `#${input}`);
  }

  // Not a number, offset, or sentinel → a cycle name. Names are optional in
  // Linear, so the candidate set is filtered client-side over the team's
  // cycles rather than through a server-side name filter.
  const conn = await withRetry(() => team.cycles({ first: RESOLVE_PAGE }));
  const nodes = await scanAll<any>(conn as any, "cycles", "linear cycle list");
  const matches = nodes.filter((c: any) => c.name?.toLowerCase() === keyword);
  if (matches.length === 0)
    throw notFound(
      `No cycle named '${input}' in this team (try a number, id, or one of ${CYCLE_SENTINELS.join("/")}).${available(
        nodes.map((c: any) => c.name),
        "linear cycle list",
      )}`,
    );
  if (matches.length > 1)
    throw ambiguous(`Multiple cycles named '${input}'; pass the cycle number or id instead.`);
  return matches[0]!.id;
}

/** One filtered request for a cycle number; `label` names it in the error. */
async function cycleByNumber(team: any, number: number, label: string): Promise<string> {
  const cycles: any = await withRetry(() =>
    team.cycles({ filter: { number: { eq: number } }, first: 1 }),
  );
  if (cycles.nodes.length === 0) throw notFound(`No cycle ${label} in this team.`);
  return cycles.nodes[0]!.id;
}

/** Resolve a project milestone by name or id within a project. */
export async function resolveMilestoneId(
  client: LinearClient,
  projectId: string,
  input: string,
): Promise<string> {
  if (isUuid(input)) return input;
  const project = await withRetry(() => client.project(projectId));
  const conn = await withRetry(() => project.projectMilestones({ first: RESOLVE_PAGE }));
  const nodes = await scanAll<any>(conn as any, "milestones", "linear milestone list");
  const lower = input.toLowerCase();
  const matches = nodes.filter((m: any) => m.name.toLowerCase() === lower);
  if (matches.length === 0)
    throw notFound(
      `No milestone '${input}' in this project.${available(
        nodes.map((m: any) => m.name),
        "linear milestone list",
      )}`,
    );
  if (matches.length > 1) throw ambiguous(`Multiple milestones match '${input}'.`);
  return matches[0]!.id;
}

/**
 * `templates` is a plain list in the schema (no arguments, no pages), so one
 * request is the whole workspace: team-scoped and shared templates alike.
 */
const TEMPLATES_QUERY = `
query CliTemplates {
  templates { id name type team { id } }
}`;

/**
 * Resolve an issue template by name or id, within a team's scope: the team's
 * own templates plus the workspace-shared ones (`team: null`), `type: "issue"`
 * only. A team template outranks a shared one of the same name — it is the more
 * specific of the two, and it is what Linear's own picker offers first.
 */
export async function resolveTemplateId(
  client: LinearClient,
  teamId: string,
  input: string,
): Promise<string> {
  if (isUuid(input)) return input;
  const data: any = await withRetry(() => (client as any).client.rawRequest(TEMPLATES_QUERY, {}));
  const all: any[] = data?.data?.templates ?? [];
  const inScope = all.filter((t) => t.type === "issue" && (!t.team || t.team.id === teamId));
  const lower = input.toLowerCase();
  const byName = inScope.filter((t) => t.name.toLowerCase() === lower);
  // Exact case first, then the team's own before the workspace's.
  const exact = byName.filter((t) => t.name === input);
  const candidates = exact.length ? exact : byName;
  const teamOwned = candidates.filter((t) => t.team);
  const finalists = teamOwned.length ? teamOwned : candidates;
  if (finalists.length === 0)
    throw notFound(
      `No issue template '${input}' for this team.${available(
        inScope.map((t) => t.name),
        `linear api '{ templates { id name type team { key } } }'`,
      )}`,
    );
  if (finalists.length > 1)
    throw ambiguous(`Multiple issue templates named '${input}'; pass the template id instead.`);
  return finalists[0]!.id;
}

/**
 * Resolve an issue by identifier (`TES-123`) or UUID. Identifier lookups go via
 * the team key + number filter so they are unambiguous and don't depend on the
 * SDK accepting human identifiers.
 */
export async function resolveIssue(client: LinearClient, input: string): Promise<Issue> {
  if (isUuid(input)) return withRetry(() => client.issue(input));
  const match = input.match(IDENTIFIER_RE);
  if (!match) throw usageError(`'${input}' is not a valid issue id (expected e.g. TES-123 or a UUID).`);
  const key = match[1]!.toUpperCase();
  const number = Number.parseInt(match[2]!, 10);
  // includeArchived so archive/unarchive/delete can operate on archived issues.
  const issues = await withRetry(() =>
    client.issues({
      filter: { team: { key: { eq: key } }, number: { eq: number } } as any,
      first: 1,
      includeArchived: true,
    }),
  );
  if (issues.nodes.length === 0) throw notFound(`No issue ${key}-${number}.`);
  return issues.nodes[0]!;
}
