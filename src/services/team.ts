/**
 * Team service: all SDK access for teams lives here so commands stay thin.
 *
 * Teams are resolved from a friendly key/name/id via `resolveTeam`; the single
 * `view` and the sub-resource listings (members, states, labels, cycles) use the
 * typed SDK connections, and mutations unwrap the `{ success, team }` payload.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { collect, pageSize } from "../lib/pagination.js";
import { usageError } from "../lib/errors.js";
import { resolveTeam } from "../lib/resolve.js";

export interface TeamRow {
  id: string;
  key: string;
  name: string;
}

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
}

/** Create a team. `name` is required; `key` is generated by Linear when omitted. */
export async function createTeam(client: LinearClient, opts: CreateTeamOptions) {
  const input: Record<string, any> = { name: opts.name };
  if (opts.key !== undefined) input.key = opts.key;
  if (opts.description !== undefined) input.description = opts.description;
  const payload = await withRetry(() => client.createTeam(input as any));
  const team = await payload.team;
  if (!team) throw usageError("Team creation returned no team.");
  return team;
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
  const payload = await withRetry(() => client.updateTeam(resolved.id, input as any));
  const team = await payload.team;
  if (!team) throw usageError("Team update returned no team.");
  return team;
}
