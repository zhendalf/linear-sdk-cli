/**
 * Cycle service: all SDK access for cycles lives here so commands stay thin.
 *
 * Lists go through the typed `team.cycles()` connection (server-side sorted by
 * number); single `view`/`current` and the mutations use the typed SDK models.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { shape } from "../lib/shape.js";
import { collect, pageSize } from "../lib/pagination.js";
import { usageError, notFound } from "../lib/errors.js";
import { unwrapMutation } from "../lib/mutation.js";
import { resolveTeam, resolveCycleId, isUuid } from "../lib/resolve.js";

export interface CycleRow {
  id: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
  progress: number;
  completedAt: string | null;
}

/** The row's shape as `linear commands` advertises it (TES-610); checked against the interface. */
export const CYCLE_ROW_SHAPE = shape<CycleRow>({
  id: "string",
  number: "number",
  name: "string|null",
  startsAt: "string",
  endsAt: "string",
  progress: "number",
  completedAt: "string|null",
});

/** List a team's cycles, newest (highest number) first. */
export async function listCycles(
  client: LinearClient,
  teamInput: string | undefined,
  limit: number,
  defaultTeamKey: string | undefined,
): Promise<CycleRow[]> {
  const team = await resolveTeam(client, teamInput, defaultTeamKey);
  const teamModel = await withRetry(() => client.team(team.id));
  const conn = await withRetry(() => teamModel.cycles({ first: pageSize(limit) }));
  const nodes = await collect(conn as any, limit);
  const rows = nodes.map(toRow);
  // Surface most-recent (highest number) cycle first.
  rows.sort((a, b) => b.number - a.number);
  return rows;
}

/** The team's currently active cycle, if any. */
export async function getCurrentCycle(
  client: LinearClient,
  teamInput: string | undefined,
  defaultTeamKey: string | undefined,
): Promise<CycleDetail> {
  const team = await resolveTeam(client, teamInput, defaultTeamKey);
  const teamModel = await withRetry(() => client.team(team.id));
  const cycle = await teamModel.activeCycle;
  if (!cycle) throw notFound(`No active cycle for team ${team.key}.`);
  return toDetail(cycle, team.key);
}

export interface CycleDetail {
  id: string;
  number: number;
  name: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string;
  completedAt: string | null;
  progress: number;
  team: string | null;
}

/** The detail's shape; checked against `CycleDetail`. */
export const CYCLE_DETAIL_SHAPE = shape<CycleDetail>({
  id: "string",
  number: "number",
  name: "string|null",
  description: "string|null",
  startsAt: "string",
  endsAt: "string",
  completedAt: "string|null",
  progress: "number",
  team: "string|null",
});

/**
 * Resolve a cycle id from `idArg`. A UUID is taken directly; a number or
 * `current` needs a team (from --team / default) to resolve against.
 */
export async function getCycleDetail(
  client: LinearClient,
  idArg: string,
  teamInput: string | undefined,
  defaultTeamKey: string | undefined,
): Promise<CycleDetail> {
  const cycleId = await resolveCycleArg(client, idArg, teamInput, defaultTeamKey);
  const cycle = await withRetry(() => client.cycle(cycleId));
  const team = await cycle.team;
  return toDetail(cycle, team?.key ?? null);
}

export interface CreateOptions {
  team?: string;
  name?: string;
  startsAt: string;
  endsAt: string;
}

export async function createCycle(
  client: LinearClient,
  opts: CreateOptions,
  defaultTeamKey: string | undefined,
) {
  const team = await resolveTeam(client, opts.team, defaultTeamKey);
  const input: Record<string, any> = {
    teamId: team.id,
    startsAt: opts.startsAt,
    endsAt: opts.endsAt,
  };
  if (opts.name !== undefined) input.name = opts.name;

  return unwrapMutation(
    withRetry(() => client.createCycle(input as any)),
    "cycle",
    "Cycle creation",
  );
}

export interface UpdateOptions {
  name?: string;
  startsAt?: string;
  endsAt?: string;
}

export async function updateCycle(
  client: LinearClient,
  idArg: string,
  opts: UpdateOptions,
  teamInput: string | undefined,
  defaultTeamKey: string | undefined,
) {
  const cycleId = await resolveCycleArg(client, idArg, teamInput, defaultTeamKey);
  const input: Record<string, any> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.startsAt !== undefined) input.startsAt = opts.startsAt;
  if (opts.endsAt !== undefined) input.endsAt = opts.endsAt;

  if (Object.keys(input).length === 0)
    throw usageError("Nothing to update; pass at least one of --name, --start, --end.");

  return unwrapMutation(
    withRetry(() => client.updateCycle(cycleId, input as any)),
    "cycle",
    "Cycle update",
  );
}

/**
 * Resolve a cycle reference (UUID, number, or `current`) to a cycle id. A UUID
 * is unambiguous; a number/`current` needs a team to scope against.
 */
async function resolveCycleArg(
  client: LinearClient,
  idArg: string,
  teamInput: string | undefined,
  defaultTeamKey: string | undefined,
): Promise<string> {
  if (isUuid(idArg)) return idArg;
  const teamKey = teamInput ?? defaultTeamKey;
  if (!teamKey)
    throw usageError("Resolving a cycle by number or 'current' requires --team (or pass a cycle id).");
  const team = await resolveTeam(client, teamKey, undefined);
  return resolveCycleId(client, team.id, idArg);
}

function toRow(c: any): CycleRow {
  return {
    id: c.id,
    number: c.number,
    name: c.name ?? null,
    startsAt: dateStr(c.startsAt),
    endsAt: dateStr(c.endsAt),
    progress: c.progress,
    completedAt: c.completedAt ? dateStr(c.completedAt) : null,
  };
}

function toDetail(c: any, teamKey: string | null): CycleDetail {
  return {
    id: c.id,
    number: c.number,
    name: c.name ?? null,
    description: c.description ?? null,
    startsAt: dateStr(c.startsAt),
    endsAt: dateStr(c.endsAt),
    completedAt: c.completedAt ? dateStr(c.completedAt) : null,
    progress: c.progress,
    team: teamKey,
  };
}

/** Normalize a Date (SDK model) or string into an ISO string. */
export function dateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Human-friendly progress percentage (0..1 → "42%"). Exported for tests. */
export function formatProgress(progress: number): string {
  return `${Math.round((progress ?? 0) * 100)}%`;
}
