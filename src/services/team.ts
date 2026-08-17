/**
 * Team service: all SDK access for teams lives here so commands stay thin.
 *
 * Teams are resolved from a friendly key/name/id via `resolveTeam`; the single
 * `view` and the sub-resource listings (members, states, labels, cycles) use the
 * typed SDK connections, and mutations unwrap the `{ success, team }` payload.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { shape } from "../lib/shape.js";
import { collect, pageSize } from "../lib/pagination.js";
import { usageError } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import { resolveTeam, type ResolvedTeam } from "../lib/resolve.js";

export interface TeamRow {
  id: string;
  key: string;
  name: string;
}

/** The row's shape as `linear commands` advertises it (TES-610); checked against the interface. */
export const TEAM_ROW_SHAPE = shape<TeamRow>({ id: "string", key: "string", name: "string" });

/** All teams (key, name, id). */
export async function listTeams(client: LinearClient, limit: number): Promise<TeamRow[]> {
  const conn = await withRetry(() => client.teams({ first: limit === Infinity ? 100 : Math.min(limit, 250) }));
  const nodes = await collect(conn as any, limit);
  return nodes.map((t: any) => ({ id: t.id, key: t.key, name: t.name }));
}

export interface TeamDetail {
  id: string;
  key: string;
  name: string;
  description: string | null;
  private: boolean;
  cyclesEnabled: boolean;
  timezone: string | null;
  color: string | null;
  icon: string | null;
  issueCount: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/** The detail's shape; checked against `TeamDetail`. */
export const TEAM_DETAIL_SHAPE = shape<TeamDetail>({
  id: "string",
  key: "string",
  name: "string",
  description: "string|null",
  private: "boolean",
  cyclesEnabled: "boolean",
  timezone: "string|null",
  color: "string|null",
  icon: "string|null",
  issueCount: "number",
  memberCount: "number",
  createdAt: "string",
  updatedAt: "string",
});

export async function getTeamDetail(
  client: LinearClient,
  keyArg: string | undefined,
  defaultTeamKey: string | undefined,
): Promise<TeamDetail> {
  const resolved = await resolveTeam(client, keyArg, defaultTeamKey);
  const team = await withRetry(() => client.team(resolved.id));
  // Count members via the connection (no direct count field on Team). Deactivated
  // users are excluded — `includeDisabled` is passed explicitly rather than left
  // to the server default so the intent is visible here.
  const members = await collect(
    (await withRetry(() => team.members({ first: 100, includeDisabled: false }))) as any,
    Infinity,
  );
  return {
    id: team.id,
    key: team.key,
    name: team.name,
    description: team.description ?? null,
    private: !!team.private,
    cyclesEnabled: !!team.cyclesEnabled,
    timezone: team.timezone ?? null,
    color: team.color ?? null,
    icon: team.icon ?? null,
    issueCount: team.issueCount ?? 0,
    memberCount: members.length,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
}

export interface MemberRow {
  id: string;
  displayName: string;
  name: string;
  email: string;
  active: boolean;
}

export const TEAM_MEMBER_ROW_SHAPE = shape<MemberRow>({
  id: "string",
  displayName: "string",
  name: "string",
  email: "string",
  active: "boolean",
});

/**
 * List a team's members. Linear defaults `includeDisabled` to false, so
 * deactivated users are invisible (and the `active` column constantly true)
 * unless the caller opts in.
 */
export async function listMembers(
  client: LinearClient,
  keyArg: string | undefined,
  defaultTeamKey: string | undefined,
  limit: number,
  includeDisabled = false,
): Promise<MemberRow[]> {
  const resolved = await resolveTeam(client, keyArg, defaultTeamKey);
  const team = await withRetry(() => client.team(resolved.id));
  const nodes = await collect(
    (await withRetry(() => team.members({ first: pageSize(limit), includeDisabled }))) as any,
    limit,
  );
  return nodes.map((u: any) => ({
    id: u.id,
    displayName: u.displayName,
    name: u.name,
    email: u.email,
    active: !!u.active,
  }));
}

export interface StateRow {
  id: string;
  name: string;
  type: string;
  color: string;
  position: number;
}

export const TEAM_STATE_ROW_SHAPE = shape<StateRow>({
  id: "string",
  name: "string",
  type: "string",
  color: "string",
  position: "number",
});

export async function listStates(
  client: LinearClient,
  keyArg: string | undefined,
  defaultTeamKey: string | undefined,
  limit: number,
): Promise<StateRow[]> {
  const resolved = await resolveTeam(client, keyArg, defaultTeamKey);
  const team = await withRetry(() => client.team(resolved.id));
  const nodes = await collect((await withRetry(() => team.states())) as any, limit);
  return nodes
    .map((s: any) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      color: s.color,
      position: s.position,
    }))
    .sort((a: StateRow, b: StateRow) => a.position - b.position);
}

export interface LabelRow {
  id: string;
  name: string;
  color: string;
}

export const TEAM_LABEL_ROW_SHAPE = shape<LabelRow>({ id: "string", name: "string", color: "string" });

export async function listLabels(
  client: LinearClient,
  keyArg: string | undefined,
  defaultTeamKey: string | undefined,
  limit: number,
): Promise<LabelRow[]> {
  const resolved = await resolveTeam(client, keyArg, defaultTeamKey);
  const team = await withRetry(() => client.team(resolved.id));
  const nodes = await collect((await withRetry(() => team.labels())) as any, limit);
  return nodes.map((l: any) => ({ id: l.id, name: l.name, color: l.color }));
}

export interface CycleRow {
  id: string;
  number: number;
  name: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export const TEAM_CYCLE_ROW_SHAPE = shape<CycleRow>({
  id: "string",
  number: "number",
  name: "string|null",
  startsAt: "string|null",
  endsAt: "string|null",
});

export async function listCycles(
  client: LinearClient,
  keyArg: string | undefined,
  defaultTeamKey: string | undefined,
  limit: number,
): Promise<CycleRow[]> {
  const resolved = await resolveTeam(client, keyArg, defaultTeamKey);
  const team = await withRetry(() => client.team(resolved.id));
  const nodes = await collect((await withRetry(() => team.cycles())) as any, limit);
  return nodes.map((c: any) => ({
    id: c.id,
    number: c.number,
    name: c.name ?? null,
    startsAt: c.startsAt?.toISOString?.() ?? (c.startsAt ? String(c.startsAt) : null),
    endsAt: c.endsAt?.toISOString?.() ?? (c.endsAt ? String(c.endsAt) : null),
  }));
}

export interface CreateTeamOptions {
  name: string;
  key?: string;
  description?: string;
  /** A private team is visible to its members only. Sent only when true (Linear's default is public). */
  private?: boolean;
}

/** Create a team. `name` is required; `key` is generated by Linear when omitted. */
export async function createTeam(client: LinearClient, opts: CreateTeamOptions) {
  const input: Record<string, any> = { name: opts.name };
  if (opts.key !== undefined) input.key = opts.key;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.private) input.private = true;
  return unwrapMutation(
    withRetry(() => client.createTeam(input as any)),
    "team",
    "Team creation",
  );
}

export interface UpdateTeamOptions {
  name?: string;
  key?: string;
  description?: string;
}

export async function updateTeam(
  client: LinearClient,
  keyArg: string | undefined,
  defaultTeamKey: string | undefined,
  opts: UpdateTeamOptions,
) {
  const resolved = await resolveTeam(client, keyArg, defaultTeamKey);
  const input: Record<string, any> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.key !== undefined) input.key = opts.key;
  if (opts.description !== undefined) input.description = opts.description;
  if (Object.keys(input).length === 0)
    throw usageError("Nothing to update; pass at least one field (--name/--key/--description).");
  return unwrapMutation(
    withRetry(() => client.updateTeam(resolved.id, input as any)),
    "team",
    "Team update",
  );
}

/** What `team delete` needs to know before it asks: the team, and how much goes with it. */
export interface DeleteTeamPlan {
  team: ResolvedTeam;
  /** The team's live issues — the ones a delete takes with it, or `--move-issues` rescues. */
  issueCount: number;
  /** Set when `--move-issues` named a (different, existing) team. */
  moveTo?: ResolvedTeam;
}

/**
 * Resolve everything `team delete` will act on, so the confirmation can name
 * the team, the issue count and the destination before anything is written.
 * The key is required — a delete must never fall through to the configured
 * default team the way `team view` does.
 */
export async function planDeleteTeam(
  client: LinearClient,
  keyArg: string,
  moveIssuesTo: string | undefined,
): Promise<DeleteTeamPlan> {
  const team = await resolveTeam(client, keyArg, undefined);
  const model = await withRetry(() => client.team(team.id));
  const plan: DeleteTeamPlan = { team, issueCount: model.issueCount ?? 0 };
  if (moveIssuesTo !== undefined) {
    const moveTo = await resolveTeam(client, moveIssuesTo, undefined);
    if (moveTo.id === team.id) {
      throw usageError(`--move-issues names ${team.key} itself; pick a different team.`);
    }
    plan.moveTo = moveTo;
  }
  return plan;
}

/** Linear's cap on `issueBatchUpdate` ids per call. */
const MOVE_BATCH = 50;

/**
 * Move every live issue on `from` to `to`, in batches. Returns how many moved.
 * Archived and trashed issues stay where they are — the API's team listing
 * excludes them and Linear takes them along with the team.
 */
export async function moveTeamIssues(
  client: LinearClient,
  from: ResolvedTeam,
  to: ResolvedTeam,
): Promise<number> {
  const team = await withRetry(() => client.team(from.id));
  const issues = await collect((await withRetry(() => team.issues({ first: 100 }))) as any, Infinity);
  const ids = issues.map((i: any) => i.id as string);
  for (let i = 0; i < ids.length; i += MOVE_BATCH) {
    const batch = ids.slice(i, i + MOVE_BATCH);
    await assertMutation(
      withRetry(() => client.updateIssueBatch(batch, { teamId: to.id })),
      `Moving ${batch.length} issue(s) to ${to.key}`,
    );
  }
  return ids.length;
}

/**
 * Delete a team (`teamDelete`). Linear archives the team and everything on it;
 * a plan that does not allow it answers with an API error, which reaches the
 * user as `feature_not_accessible` like every other plan gate.
 */
export async function deleteTeam(client: LinearClient, team: ResolvedTeam): Promise<void> {
  await assertMutation(withRetry(() => client.deleteTeam(team.id)), "Team deletion");
}
