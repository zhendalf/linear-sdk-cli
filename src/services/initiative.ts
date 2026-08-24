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
import { shape } from "../lib/shape.js";
import { collect, collectRawQuery } from "../lib/pagination.js";
import { usageError, notFound, ambiguous } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import {
  resolveUserId,
  resolveInitiativeLabelIds,
  resolveProjectId,
  isUuid,
} from "../lib/resolve.js";

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

/** The row's shape as `linear commands` advertises it (TES-610); checked against the interface. */
export const INITIATIVE_ROW_SHAPE = shape<InitiativeRow>({
  id: "string",
  name: "string",
  status: "string|null",
  priority: "number",
  targetDate: "string|null",
  health: "string|null",
  url: "string",
});

const LIST_QUERY = `
query CliInitiatives($filter: InitiativeFilter, $first: Int!, $after: String, $includeArchived: Boolean) {
  initiatives(filter: $filter, first: $first, after: $after, includeArchived: $includeArchived) {
    nodes {
      id name status priority targetDate health url
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export interface ListFilters {
  /** One of the InitiativeStatus values, any case (validated by `resolveStatus`). */
  status?: string;
  /** me|email|name|id — resolved to a user id. */
  owner?: string;
  /** Include archived initiatives (the API excludes them by default). */
  archived?: boolean;
}

/** Build an InitiativeFilter from human options, resolving names to ids. Exported for tests. */
export async function buildFilter(
  client: LinearClient,
  f: ListFilters,
): Promise<Record<string, unknown>> {
  const filter: Record<string, any> = {};
  if (f.status) filter.status = { eq: resolveStatus(f.status) };
  if (f.owner) filter.owner = { id: { eq: await resolveUserId(client, f.owner) } };
  return filter;
}

/** List workspace initiatives (most-recently created come from the API order). */
export async function listInitiatives(
  client: LinearClient,
  limit: number,
  filters: ListFilters = {},
): Promise<InitiativeRow[]> {
  const filter = await buildFilter(client, filters);
  return collectRawQuery<InitiativeRow>(
    client as any,
    LIST_QUERY,
    { filter, includeArchived: filters.archived === true },
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
  icon: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  owner: string | null;
  creator: string | null;
  /** The projects linked to the initiative (`initiative add-project`), API order. */
  projects: Array<{ id: string; name: string; status: { name: string; type: string } | null }>;
}

/** The detail's shape; checked against `InitiativeDetail`. */
export const INITIATIVE_DETAIL_SHAPE = shape<InitiativeDetail>({
  id: "string",
  name: "string",
  description: "string|null",
  status: "string|null",
  priority: "number",
  priorityLabel: "string",
  labels: ["string"],
  health: "string|null",
  targetDate: "string|null",
  color: "string|null",
  icon: "string|null",
  url: "string",
  createdAt: "string",
  updatedAt: "string",
  startedAt: "string|null",
  completedAt: "string|null",
  archivedAt: "string|null",
  owner: "string|null",
  creator: "string|null",
  projects: [
    { id: "string", name: "string", status: { nullable: { name: "string", type: "string" } } },
  ],
});

/** How many linked projects `view` reads; more than this is unusual and shows a truncation note. */
const PROJECTS_PAGE = 100;

export async function getInitiativeDetail(
  client: LinearClient,
  idArg: string,
): Promise<InitiativeDetail> {
  // An id finds an archived initiative too (`view` after `archive` still
  // works); a name matches live ones only, so an archived namesake cannot make
  // a live initiative ambiguous.
  const initiative = await resolveInitiative(client, idArg, { includeArchived: isUuid(idArg) });
  const [owner, creator, labels, projects] = await Promise.all([
    initiative.owner,
    initiative.creator,
    initiative.labels(),
    initiative.projects({ first: PROJECTS_PAGE }),
  ]);
  const projectRows = await Promise.all(
    (projects?.nodes ?? []).map(async (p: any) => {
      const status = await p.status;
      return {
        id: p.id,
        name: p.name,
        status: status ? { name: status.name, type: status.type } : null,
      };
    }),
  );
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
    icon: initiative.icon ?? null,
    url: initiative.url,
    createdAt: initiative.createdAt.toISOString(),
    updatedAt: initiative.updatedAt.toISOString(),
    startedAt: initiative.startedAt ? initiative.startedAt.toISOString() : null,
    completedAt: initiative.completedAt ? initiative.completedAt.toISOString() : null,
    archivedAt: initiative.archivedAt ? initiative.archivedAt.toISOString() : null,
    owner: owner?.displayName ?? null,
    creator: creator?.displayName ?? null,
    projects: projectRows,
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
  icon?: string;
  color?: string;
}

export async function createInitiative(client: LinearClient, opts: CreateOptions) {
  const input: Record<string, any> = { name: opts.name };
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.targetDate) input.targetDate = opts.targetDate;
  if (opts.owner) input.ownerId = await resolveUserId(client, opts.owner);
  if (opts.status) input.status = resolveStatus(opts.status);
  if (opts.priority !== undefined) input.priority = resolvePriority(opts.priority);
  if (opts.label?.length) input.labelIds = await resolveInitiativeLabelIds(client, opts.label);
  if (opts.icon) input.icon = opts.icon;
  if (opts.color) input.color = opts.color;

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
  icon?: string;
  color?: string;
}

export async function updateInitiative(client: LinearClient, idArg: string, opts: UpdateOptions) {
  const initiative = await resolveInitiative(client, idArg);
  const input: Record<string, any> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.targetDate) input.targetDate = opts.targetDate;
  if (opts.owner) input.ownerId = await resolveUserId(client, opts.owner);
  if (opts.status) input.status = resolveStatus(opts.status);
  if (opts.priority !== undefined) input.priority = resolvePriority(opts.priority);
  if (opts.label) input.labelIds = await resolveInitiativeLabelIds(client, opts.label);
  if (opts.icon) input.icon = opts.icon;
  if (opts.color) input.color = opts.color;

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
 * Unarchive an initiative. Resolution includes archived initiatives — the
 * whole point is that the target is one — where every other resolver here
 * matches live ones only.
 */
export async function unarchiveInitiative(client: LinearClient, idArg: string) {
  const initiative = await resolveInitiative(client, idArg, { includeArchived: true });
  if (!initiative.archivedAt) {
    throw usageError(`Initiative ${initiative.name} is not archived.`);
  }
  await assertMutation(
    withRetry(() => client.unarchiveInitiative(initiative.id)),
    "Initiative unarchive",
  );
  return initiative;
}

/** The link `add-project` made / `remove-project` removes, plus both ends for the receipt. */
export interface ProjectLink {
  /** The InitiativeToProject id. */
  id: string;
  initiative: { id: string; name: string };
  project: { id: string; name: string };
}

/** The `add-project`/`remove-project` receipt body; checked against `ProjectLink`. */
export const PROJECT_LINK_SHAPE = shape<ProjectLink>({
  id: "string",
  initiative: { id: "string", name: "string" },
  project: { id: "string", name: "string" },
});

/**
 * Link a project to an initiative (`initiativeToProjectCreate`). Linear allows
 * a project in one initiative at a time; a second link is refused by the API
 * ("Project already related to a parent or child initiative"), which reaches
 * the user as a validation error.
 */
export async function addProject(
  client: LinearClient,
  initiativeArg: string,
  projectArg: string,
  opts: { sortOrder?: number } = {},
): Promise<ProjectLink> {
  const initiative = await resolveInitiative(client, initiativeArg);
  const projectId = await resolveProjectId(client, projectArg);
  const project = await withRetry(() => client.project(projectId));
  const input: Record<string, any> = { initiativeId: initiative.id, projectId };
  if (opts.sortOrder !== undefined) input.sortOrder = opts.sortOrder;
  const link = await unwrapMutation(
    withRetry(() => client.createInitiativeToProject(input as any)),
    "initiativeToProject",
    "Linking the project",
  );
  return {
    id: link.id,
    initiative: { id: initiative.id, name: initiative.name },
    project: { id: project.id, name: project.name },
  };
}

/**
 * Find the link between an initiative and a project, for `remove-project` to
 * name before it asks and to delete after. Read off the project's links (a
 * project has at most a handful) rather than the workspace-wide
 * `initiativeToProjects` feed, which has no filter and would have to be paged
 * in full.
 */
export async function findProjectLink(
  client: LinearClient,
  initiativeArg: string,
  projectArg: string,
): Promise<ProjectLink> {
  const initiative = await resolveInitiative(client, initiativeArg);
  const projectId = await resolveProjectId(client, projectArg);
  const project = await withRetry(() => client.project(projectId));
  const links: any[] = await collect(
    (await withRetry(() => project.initiativeToProjects({ first: 50 }))) as any,
    Infinity,
  );
  const link = links.find((l) => l.initiativeId === initiative.id);
  if (!link) {
    throw notFound(
      `Project ${project.name} is not linked to initiative ${initiative.name}. ` +
        `Run 'linear initiative view ${initiative.name}' to see its projects.`,
    );
  }
  return {
    id: link.id,
    initiative: { id: initiative.id, name: initiative.name },
    project: { id: project.id, name: project.name },
  };
}

/** Remove a link found by `findProjectLink` (`initiativeToProjectDelete`). */
export async function removeProjectLink(client: LinearClient, link: ProjectLink): Promise<void> {
  await assertMutation(
    withRetry(() => client.deleteInitiativeToProject(link.id)),
    "Unlinking the project",
  );
}

/**
 * Resolve an initiative by id (UUID, fetched directly) or by name (listed and
 * matched case-insensitively; ambiguity is an error). By name, archived
 * initiatives are considered only when `includeArchived` says so.
 */
export async function resolveInitiative(
  client: LinearClient,
  idArg: string,
  opts: { includeArchived?: boolean } = {},
) {
  if (isUuid(idArg)) return withRetry(() => client.initiative(idArg));
  const lower = idArg.toLowerCase();
  let after: string | undefined;
  const matches: any[] = [];
  for (;;) {
    const conn = await withRetry(() =>
      client.initiatives({
        first: 100,
        after,
        includeArchived: opts.includeArchived === true,
      } as any),
    );
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
  if (!match) throw usageError(`Invalid status '${input}'. Valid: ${STATUSES.join(", ")}.`);
  return match;
}
