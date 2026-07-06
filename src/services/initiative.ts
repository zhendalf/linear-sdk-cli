/**
 * Initiative service: all SDK access for initiatives lives here so commands stay thin.
 *
 * Initiatives are workspace-scoped (no team). The list uses a tailored GraphQL
 * query (one round-trip, no N+1 on the owner's name); the single `view` and all
 * mutations use the typed SDK models. Mutations unwrap the `{ success, initiative }`
 * payload. Initiatives may be plan-gated; errors propagate as CliError.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { collectRawQuery } from "../lib/pagination.js";
import { usageError, notFound, ambiguous } from "../lib/errors.js";
import { resolveUserId, isUuid } from "../lib/resolve.js";

/** The five status values Linear accepts for an initiative (InitiativeStatus enum). */
const STATUSES = ["Planned", "Active", "Completed", "Canceled", "Proposed"] as const;

export interface InitiativeRow {
  id: string;
  name: string;
  status: string | null;
  targetDate: string | null;
  health: string | null;
  url: string;
}

const LIST_QUERY = `
query CliInitiatives($first: Int!, $after: String, $includeArchived: Boolean) {
  initiatives(first: $first, after: $after, includeArchived: $includeArchived) {
    nodes {
      id name status targetDate health url
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** List workspace initiatives (most-recently created come from the API order). */
export async function listInitiatives(
  client: LinearClient,
  limit: number,
): Promise<InitiativeRow[]> {
  return collectRawQuery<InitiativeRow>(
    client as any,
    LIST_QUERY,
    { includeArchived: false },
    "initiatives",
    limit,
    (n) => ({
      id: n.id,
      name: n.name,
      status: n.status ?? null,
      targetDate: n.targetDate ?? null,
      health: n.health ?? null,
      url: n.url,
    }),
  );
}

export interface InitiativeDetail {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  health: string | null;
  targetDate: string | null;
  color: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  owner: string | null;
  creator: string | null;
}

export async function getInitiativeDetail(
  client: LinearClient,
  idArg: string,
): Promise<InitiativeDetail> {
  const initiative = await resolveInitiative(client, idArg);
  const [owner, creator] = await Promise.all([initiative.owner, initiative.creator]);
  return {
    id: initiative.id,
    name: initiative.name,
    description: initiative.description ?? null,
    status: initiative.status ?? null,
    health: initiative.health ?? null,
    targetDate: initiative.targetDate ?? null,
    color: initiative.color ?? null,
    url: initiative.url,
    createdAt: initiative.createdAt.toISOString(),
    updatedAt: initiative.updatedAt.toISOString(),
    startedAt: initiative.startedAt ? initiative.startedAt.toISOString() : null,
    completedAt: initiative.completedAt ? initiative.completedAt.toISOString() : null,
    owner: owner?.displayName ?? null,
    creator: creator?.displayName ?? null,
  };
}

export interface CreateOptions {
  name: string;
  description?: string;
  targetDate?: string;
  owner?: string;
  status?: string;
}

export async function createInitiative(client: LinearClient, opts: CreateOptions) {
  const input: Record<string, any> = { name: opts.name };
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.targetDate) input.targetDate = opts.targetDate;
  if (opts.owner) input.ownerId = await resolveUserId(client, opts.owner);
  if (opts.status) input.status = resolveStatus(opts.status);

  const payload = await withRetry(() => client.createInitiative(input as any));
  const initiative = await payload.initiative;
  if (!initiative) throw usageError("Initiative creation returned no initiative.");
  return initiative;
}

export interface UpdateOptions {
  name?: string;
  description?: string;
  targetDate?: string;
  owner?: string;
  status?: string;
}

export async function updateInitiative(
  client: LinearClient,
  idArg: string,
  opts: UpdateOptions,
) {
  const initiative = await resolveInitiative(client, idArg);
  const input: Record<string, any> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.targetDate) input.targetDate = opts.targetDate;
  if (opts.owner) input.ownerId = await resolveUserId(client, opts.owner);
  if (opts.status) input.status = resolveStatus(opts.status);

  if (Object.keys(input).length === 0)
    throw usageError("Nothing to update; pass at least one field.");

  const payload = await withRetry(() => client.updateInitiative(initiative.id, input as any));
  const updated = await payload.initiative;
  if (!updated) throw usageError("Initiative update returned no initiative.");
  return updated;
}

export async function archiveInitiative(client: LinearClient, idArg: string) {
  const initiative = await resolveInitiative(client, idArg);
  await withRetry(() => client.archiveInitiative(initiative.id));
  return initiative;
}

export async function deleteInitiative(client: LinearClient, idArg: string) {
  const initiative = await resolveInitiative(client, idArg);
  await withRetry(() => client.deleteInitiative(initiative.id));
  return initiative;
}

/**
 * Resolve an initiative by id (UUID, fetched directly) or by name (listed and
 * matched case-insensitively; ambiguity is an error).
 */
export async function resolveInitiative(client: LinearClient, idArg: string) {
  if (isUuid(idArg)) return withRetry(() => client.initiative(idArg));
  const lower = idArg.toLowerCase();
  let after: string | undefined;
  const matches: any[] = [];
  for (;;) {
    const conn = await withRetry(() => client.initiatives({ first: 100, after } as any));
    for (const n of conn.nodes) {
      if (n.name.toLowerCase() === lower) matches.push(n);
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor ?? undefined;
  }
  if (matches.length === 0) throw notFound(`No initiative matching '${idArg}'.`);
  if (matches.length > 1)
    throw ambiguous(`Multiple initiatives match '${idArg}'; pass the initiative id instead.`);
  return matches[0]!;
}

/** Normalize a human status into the InitiativeStatus enum value Linear expects. */
export function resolveStatus(input: string): string {
  const lower = input.toLowerCase();
  const match = STATUSES.find((s) => s.toLowerCase() === lower);
  if (!match)
    throw usageError(`Invalid status '${input}'. Valid: ${STATUSES.join(", ")}.`);
  return match;
}
