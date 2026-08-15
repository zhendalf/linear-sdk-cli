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
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import { resolveUserId, resolveInitiativeLabelIds, isUuid } from "../lib/resolve.js";

/** The five status values Linear accepts for an initiative (InitiativeStatus enum). */
const STATUSES = ["Planned", "Active", "Completed", "Canceled", "Proposed"] as const;

/**
 * Initiative priority mirrors issue priority (0 = none … 4 = low) but, unlike
 * Issue, the Initiative type exposes no `priorityLabel`, so we name it here.
 */
const PRIORITY_LABELS = ["No priority", "Urgent", "High", "Medium", "Low"] as const;

/** Validate an initiative priority and return it. */
export function resolvePriority(input: number): number {
  if (!Number.isInteger(input) || input < 0 || input > 4)
    throw usageError(
      `Invalid priority '${input}'. Valid: 0 (none), 1 (urgent), 2 (high), 3 (medium), 4 (low).`,
    );
  return input;
}

/** Human name for an initiative priority, for table/detail output. */
export function priorityLabel(priority: number | null | undefined): string {
  return PRIORITY_LABELS[priority ?? 0] ?? String(priority);
}

export interface InitiativeRow {
  id: string;
  name: string;
  status: string | null;
  priority: number;
  targetDate: string | null;
  health: string | null;
  url: string;
}

const LIST_QUERY = `
query CliInitiatives($first: Int!, $after: String, $includeArchived: Boolean) {
  initiatives(first: $first, after: $after, includeArchived: $includeArchived) {
    nodes {
      id name status priority targetDate health url
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
      priority: n.priority ?? 0,
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
  priority: number;
  priorityLabel: string;
  labels: string[];
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
  const [owner, creator, labels] = await Promise.all([
    initiative.owner,
    initiative.creator,
    initiative.labels(),
  ]);
  return {
    id: initiative.id,
    name: initiative.name,
    description: initiative.description ?? null,
    status: initiative.status ?? null,
    priority: initiative.priority ?? 0,
    priorityLabel: priorityLabel(initiative.priority),
    labels: (labels?.nodes ?? []).map((l: any) => l.name),
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
  priority?: number;
  label?: string[];
}

export async function createInitiative(client: LinearClient, opts: CreateOptions) {
  const input: Record<string, any> = { name: opts.name };
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.targetDate) input.targetDate = opts.targetDate;
  if (opts.owner) input.ownerId = await resolveUserId(client, opts.owner);
  if (opts.status) input.status = resolveStatus(opts.status);
  if (opts.priority !== undefined) input.priority = resolvePriority(opts.priority);
  if (opts.label?.length) input.labelIds = await resolveInitiativeLabelIds(client, opts.label);

  return unwrapMutation(
    withRetry(() => client.createInitiative(input as any)),
    "initiative",
    "Initiative creation",
  );
}

export interface UpdateOptions {
  name?: string;
  description?: string;
  targetDate?: string;
  owner?: string;
  status?: string;
  priority?: number;
  /** Replaces the whole label set (matching `issue update --label`). */
  label?: string[];
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
  if (opts.priority !== undefined) input.priority = resolvePriority(opts.priority);
  if (opts.label) input.labelIds = await resolveInitiativeLabelIds(client, opts.label);

  if (Object.keys(input).length === 0)
    throw usageError("Nothing to update; pass at least one field.");

  return unwrapMutation(
    withRetry(() => client.updateInitiative(initiative.id, input as any)),
    "initiative",
    "Initiative update",
  );
}

export async function archiveInitiative(client: LinearClient, idArg: string) {
  const initiative = await resolveInitiative(client, idArg);
  await assertMutation(
    withRetry(() => client.archiveInitiative(initiative.id)),
    "Initiative archive",
  );
  return initiative;
}

export async function deleteInitiative(client: LinearClient, idArg: string) {
  const initiative = await resolveInitiative(client, idArg);
  await assertMutation(
    withRetry(() => client.deleteInitiative(initiative.id)),
    "Initiative deletion",
  );
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
