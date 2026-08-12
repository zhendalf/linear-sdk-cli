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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string): boolean => UUID_RE.test(v);

const IDENTIFIER_RE = /^([a-zA-Z][a-zA-Z0-9]*)-(\d+)$/;

/** Known workflow-state types, used to decide name-vs-type filtering. */
export const STATE_TYPES = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];

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
  const teams = await withRetry(() => client.teams({ first: 250 }));
  const lower = value.toLowerCase();
  const byKey = teams.nodes.filter((t) => t.key.toLowerCase() === lower);
  const matches = byKey.length ? byKey : teams.nodes.filter((t) => t.name.toLowerCase() === lower);
  if (matches.length === 0) throw notFound(`No team matching '${value}'.`);
  if (matches.length > 1) throw ambiguous(`Multiple teams match '${value}': ${matches.map((t) => t.key).join(", ")}`);
  const team = matches[0]!;
  return { id: team.id, key: team.key, name: team.name };
}

/** Resolve an assignee reference (`me`, email, name, or id) to a user id. */
export async function resolveUserId(client: LinearClient, input: string): Promise<string> {
  if (input === "me" || input === "@me") {
    const me = await withRetry(() => client.viewer);
    return me.id;
  }
  if (isUuid(input)) return input;
  const isEmail = input.includes("@");
  const filter = isEmail ? { email: { eq: input } } : { displayName: { eqIgnoreCase: input } };
  let users = await withRetry(() => client.users({ filter: filter as any, first: 10 }));
  if (users.nodes.length === 0 && !isEmail) {
    users = await withRetry(() => client.users({ filter: { name: { eqIgnoreCase: input } } as any, first: 10 }));
  }
  if (users.nodes.length === 0) throw notFound(`No user matching '${input}'.`);
  if (users.nodes.length > 1)
    throw ambiguous(`Multiple users match '${input}': ${users.nodes.map((u) => u.email).join(", ")}`);
  return users.nodes[0]!.id;
}

/** Resolve a workflow state (by name or type) within a team to a state id. */
export async function resolveStateId(
  client: LinearClient,
  teamId: string,
  input: string,
): Promise<string> {
  if (isUuid(input)) return input;
  const team = await withRetry(() => client.team(teamId));
  const states = await withRetry(() => team.states({ first: 100 }));
  const lower = input.toLowerCase();
  const byName = states.nodes.filter((s) => s.name.toLowerCase() === lower);
  const matches = byName.length ? byName : states.nodes.filter((s) => s.type.toLowerCase() === lower);
  if (matches.length === 0)
    throw notFound(`No workflow state '${input}' in team. Available: ${states.nodes.map((s) => s.name).join(", ")}`);
  if (matches.length > 1)
    throw ambiguous(`Multiple states match '${input}': ${matches.map((s) => s.name).join(", ")}`);
  return matches[0]!.id;
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
    const labels = await withRetry(() =>
      client.issueLabels({ filter: { name: { eqIgnoreCase: name } } as any, first: 50 }),
    );
    if (labels.nodes.length === 0) throw notFound(`No label matching '${name}'.`);

    // Narrow to this team's labels + workspace-level labels when a team is known.
    // If a team is known and nothing is in scope, that's not-found (do NOT fall
    // back to an out-of-scope label from another team).
    let candidates = labels.nodes;
    if (teamId) {
      const scoped = await Promise.all(
        labels.nodes.map(async (l) => ({ label: l, team: await l.team })),
      );
      candidates = scoped.filter((s) => !s.team || s.team.id === teamId).map((s) => s.label);
      if (candidates.length === 0) throw notFound(`No label '${name}' in this team or workspace.`);
    }

    // Prefer an exact (case-sensitive) match.
    const exact = candidates.filter((l) => l.name === name);
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
    const labels: any = await withRetry(() =>
      (client as any).initiativeLabels({ filter: { name: { eqIgnoreCase: name } }, first: 50 }),
    );
    const candidates = (labels.nodes as any[]).filter((l) => !l.isGroup);
    if (candidates.length === 0) throw notFound(`No initiative label matching '${name}'.`);

    // Prefer an exact (case-sensitive) match before declaring ambiguity.
    const exact = candidates.filter((l) => l.name === name);
    const finalists = exact.length ? exact : candidates;
    if (finalists.length > 1)
      throw ambiguous(`Multiple initiative labels named '${name}'; pass the label id instead.`);
    ids.push(finalists[0]!.id);
  }
  return ids;
}

/** First workflow state of a given type (lowest position) within a team. */
export async function firstStateOfType(
  client: LinearClient,
  teamId: string,
  type: string,
): Promise<string> {
  const team = await withRetry(() => client.team(teamId));
  const states = await withRetry(() => team.states({ first: 100 }));
  const ofType = states.nodes
    .filter((s) => s.type === type)
    .sort((a, b) => a.position - b.position);
  if (ofType.length === 0) throw notFound(`No '${type}' workflow state in this team.`);
  return ofType[0]!.id;
}

/** Resolve a project by name or id. */
export async function resolveProjectId(client: LinearClient, input: string): Promise<string> {
  if (isUuid(input)) return input;
  const projects = await withRetry(() =>
    client.projects({ filter: { name: { eqIgnoreCase: input } } as any, first: 10 }),
  );
  if (projects.nodes.length === 0) throw notFound(`No project matching '${input}'.`);
  if (projects.nodes.length > 1)
    throw ambiguous(`Multiple projects match '${input}': ${projects.nodes.map((p) => p.name).join(", ")}`);
  return projects.nodes[0]!.id;
}

/** Resolve a cycle within a team by number, id, or `current`/`next`/`previous`. */
export async function resolveCycleId(
  client: LinearClient,
  teamId: string,
  input: string,
): Promise<string> {
  if (isUuid(input)) return input;
  const team = await withRetry(() => client.team(teamId));
  if (input === "current" || input === "active") {
    const cycle = await team.activeCycle;
    if (!cycle) throw notFound("No active cycle for this team.");
    return cycle.id;
  }
  const num = Number.parseInt(input, 10);
  if (!Number.isFinite(num)) throw usageError(`Cycle must be a number, id, or 'current' (got '${input}').`);
  const cycles = await withRetry(() => team.cycles({ filter: { number: { eq: num } } as any, first: 1 }));
  if (cycles.nodes.length === 0) throw notFound(`No cycle #${num} in this team.`);
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
  const milestones = await withRetry(() => project.projectMilestones({ first: 100 }));
  const lower = input.toLowerCase();
  const matches = milestones.nodes.filter((m) => m.name.toLowerCase() === lower);
  if (matches.length === 0) throw notFound(`No milestone '${input}' in this project.`);
  if (matches.length > 1) throw ambiguous(`Multiple milestones match '${input}'.`);
  return matches[0]!.id;
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
