/**
 * Project service: all SDK access for projects lives here so commands stay thin.
 *
 * Lists use a tailored GraphQL query (one round-trip, no N+1 on status/lead);
 * single `view`, milestones, updates and all mutations use the typed SDK models.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { shape } from "../lib/shape.js";
import {
  collect,
  collectRawQuery,
  inheritPaginationMetadata,
  pageSize,
} from "../lib/pagination.js";
import { usageError, notFound, ambiguous } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import {
  resolveTeam,
  resolveUserId,
  resolveProjectId,
  resolveProjectLabelIds,
  isUuid,
} from "../lib/resolve.js";

export interface ProjectRow {
  id: string;
  name: string;
  state: string | null;
  progress: number | null;
  url: string;
  startDate: string | null;
  targetDate: string | null;
  status: { name: string } | null;
  lead: { displayName: string } | null;
}

/** The row's shape as `linear commands` advertises it (TES-610); checked against the interface. */
export const PROJECT_ROW_SHAPE = shape<ProjectRow>({
  id: "string",
  name: "string",
  state: "string|null",
  progress: "number|null",
  url: "string",
  startDate: "string|null",
  targetDate: "string|null",
  status: { nullable: { name: "string" } },
  lead: { nullable: { displayName: "string" } },
});

export interface ListFilters {
  team?: string;
  /** Every team's projects: no team clause at all, and the default team is not applied. */
  allTeams?: boolean;
  state?: string;
}

const LIST_QUERY = `
query CliProjects($filter: ProjectFilter, $first: Int!, $after: String, $includeArchived: Boolean) {
  projects(filter: $filter, first: $first, after: $after, includeArchived: $includeArchived) {
    nodes {
      id name state progress url startDate targetDate
      status { name }
      lead { displayName }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Build a ProjectFilter from human options, resolving names to ids. Exported for tests. */
export async function buildFilter(
  client: LinearClient,
  f: ListFilters,
  defaultTeamKey: string | undefined,
): Promise<Record<string, unknown>> {
  const filter: Record<string, any> = {};
  // Without a team the list is scoped to the configured default, so a project
  // in another team is invisible unless `--all-teams` says the whole workspace
  // (the only other way out used to be the accidental `--team ''`).
  const teamKey = f.allTeams ? undefined : (f.team ?? defaultTeamKey);
  if (teamKey) {
    filter.accessibleTeams = { some: { key: { eq: teamKey.toUpperCase() } } };
  }
  if (f.state) {
    // Match either the custom status NAME shown in the UI ("In QA") or the
    // underlying status TYPE ("started"), case-insensitively, so both
    // vocabularies work.
    //
    // NOT `filter.state`: that targets the deprecated legacy `Project.state`
    // field, which the API silently ignores — every value, valid or not,
    // returned the unfiltered list.
    filter.status = {
      or: [{ name: { eqIgnoreCase: f.state } }, { type: { eqIgnoreCase: f.state } }],
    };
  }
  return filter;
}

export async function listProjects(
  client: LinearClient,
  filters: ListFilters,
  limit: number,
  defaultTeamKey: string | undefined,
): Promise<ProjectRow[]> {
  const filter = await buildFilter(client, filters, defaultTeamKey);
  return collectRawQuery<ProjectRow>(
    client as any,
    LIST_QUERY,
    { filter, includeArchived: false },
    "projects",
    limit,
    (n) => ({
      id: n.id,
      name: n.name,
      state: n.state ?? null,
      progress: n.progress ?? null,
      url: n.url,
      startDate: n.startDate ?? null,
      targetDate: n.targetDate ?? null,
      status: n.status ?? null,
      lead: n.lead ?? null,
    }),
  );
}

/**
 * A single project with every relation `view` shows. Relations are objects
 * with ids — `status` matches the list row's `status: { name }` and adds
 * `id`/`type`; `lead` matches the row's `lead: { displayName }` and adds
 * `id`/`email`. `teams` used to be `"KEY name"` strings, which a script could
 * not split back apart (team names contain spaces).
 */
export interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  /** The project's markdown body (Project.content), not the one-line description. */
  content: string | null;
  labels: Array<{ id: string; name: string }>;
  state: string | null;
  status: { id: string; name: string; type: string } | null;
  health: string | null;
  progress: number | null;
  priority: number;
  priorityLabel: string;
  url: string;
  startDate: string | null;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  lead: { id: string; displayName: string; email: string } | null;
  teams: Array<{ id: string; key: string; name: string }>;
  members: Array<{ id: string; displayName: string; email: string }>;
}

/** The detail's shape; checked against `ProjectDetail`. */
export const PROJECT_DETAIL_SHAPE = shape<ProjectDetail>({
  id: "string",
  name: "string",
  description: "string|null",
  content: "string|null",
  labels: [{ id: "string", name: "string" }],
  state: "string|null",
  status: { nullable: { id: "string", name: "string", type: "string" } },
  health: "string|null",
  progress: "number|null",
  priority: "number",
  priorityLabel: "string",
  url: "string",
  startDate: "string|null",
  targetDate: "string|null",
  createdAt: "string",
  updatedAt: "string",
  completedAt: "string|null",
  archivedAt: "string|null",
  lead: { nullable: { id: "string", displayName: "string", email: "string" } },
  teams: [{ id: "string", key: "string", name: "string" }],
  members: [{ id: "string", displayName: "string", email: "string" }],
});

/**
 * Everything `project view` shows, in one round-trip: the name lookup, the
 * project, and its relations, which the SDK-model path fetched one request
 * each (7 requests, measured). A UUID filters by id; anything else is a
 * case-insensitive name match — the same rule as `resolveProjectId`, with the
 * same not-found/ambiguous outcomes. An id finds an archived project too (as
 * `client.project(id)` did); a name matches live projects only (as
 * `resolveProjectId` does), so an archived namesake cannot make a live project
 * ambiguous.
 *
 * `first: 2`, not a full page: a second match already means "ambiguous", and
 * Linear prices a query by its worst case — 250 projects × three nested
 * 50-item connections was refused as too complex (49 975 against a cap of
 * 10 000, verified live).
 */
const DETAIL_QUERY = `
query CliProjectDetail($filter: ProjectFilter!, $includeArchived: Boolean!) {
  projects(filter: $filter, first: 2, includeArchived: $includeArchived) {
    nodes {
      id name description content state health progress priority priorityLabel url
      startDate targetDate createdAt updatedAt completedAt archivedAt
      status { id name type }
      lead { id displayName email }
      labels(first: 50) { nodes { id name } }
      teams(first: 50) { nodes { id key name } }
      members(first: 50) { nodes { id displayName email } }
    }
  }
}`;

export async function getProjectDetail(
  client: LinearClient,
  idArg: string,
): Promise<ProjectDetail> {
  const byId = isUuid(idArg);
  const filter = byId ? { id: { eq: idArg } } : { name: { eqIgnoreCase: idArg } };
  const data: any = await withRetry(() =>
    (client as any).client.rawRequest(DETAIL_QUERY, { filter, includeArchived: byId }),
  );
  const nodes: any[] = data.data?.projects?.nodes ?? [];
  if (nodes.length === 0)
    throw notFound(`No project matching '${idArg}'. Run 'linear project list' to see the options.`);
  if (nodes.length > 1)
    throw ambiguous(
      `Multiple projects match '${idArg}': ${nodes.map((p) => p.name).join(", ")}. Pass the project id instead.`,
    );
  const p = nodes[0];
  return {
    id: p.id,
    name: p.name,
    description: p.description || null,
    content: p.content || null,
    labels: p.labels?.nodes ?? [],
    state: p.state ?? null,
    status: p.status ?? null,
    health: p.health ?? null,
    progress: p.progress ?? null,
    priority: p.priority,
    priorityLabel: p.priorityLabel,
    url: p.url,
    startDate: p.startDate ?? null,
    targetDate: p.targetDate ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    completedAt: p.completedAt ?? null,
    archivedAt: p.archivedAt ?? null,
    lead: p.lead ?? null,
    teams: p.teams?.nodes ?? [],
    members: p.members?.nodes ?? [],
  };
}

export interface CreateOptions {
  name: string;
  description?: string;
  /** The project's markdown body — distinct from the one-line `description`. */
  content?: string;
  team?: string[];
  lead?: string;
  state?: string;
  startDate?: string;
  targetDate?: string;
  priority?: number;
  label?: string[];
  member?: string[];
  icon?: string;
  color?: string;
}

/** Build a ProjectCreateInput, resolving every human reference to an id. */
export async function createProject(
  client: LinearClient,
  opts: CreateOptions,
  defaultTeamKey: string | undefined,
) {
  const teamIds = await resolveTeamIds(client, opts.team, defaultTeamKey);
  const input: Record<string, any> = { name: opts.name, teamIds };
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.content !== undefined) input.content = opts.content;
  if (opts.state) input.statusId = await resolveStatusId(client, opts.state);
  if (opts.lead) input.leadId = await resolveUserId(client, opts.lead);
  if (opts.startDate) input.startDate = opts.startDate;
  if (opts.targetDate) input.targetDate = opts.targetDate;
  if (opts.priority !== undefined) input.priority = resolvePriority(opts.priority);
  if (opts.label?.length) input.labelIds = await resolveProjectLabelIds(client, opts.label);
  if (opts.member?.length) input.memberIds = await resolveMemberIds(client, opts.member);
  if (opts.icon) input.icon = opts.icon;
  if (opts.color) input.color = opts.color;

  return unwrapMutation(
    withRetry(() => client.createProject(input as any)),
    "project",
    "Project creation",
  );
}

export interface UpdateOptions {
  name?: string;
  description?: string;
  /** The project's markdown body — distinct from the one-line `description`. */
  content?: string;
  team?: string[];
  lead?: string;
  state?: string;
  startDate?: string;
  targetDate?: string;
  priority?: number;
  /** Replaces the whole label set. */
  label?: string[];
  /** Replaces the whole member set. */
  member?: string[];
  icon?: string;
  color?: string;
}

export async function updateProject(client: LinearClient, idArg: string, opts: UpdateOptions) {
  const projectId = await resolveProjectId(client, idArg);
  const input: Record<string, any> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.content !== undefined) input.content = opts.content;
  if (opts.team?.length) input.teamIds = await resolveTeamIds(client, opts.team, undefined);
  if (opts.lead) input.leadId = await resolveUserId(client, opts.lead);
  if (opts.state) input.statusId = await resolveStatusId(client, opts.state);
  if (opts.startDate) input.startDate = opts.startDate;
  if (opts.targetDate) input.targetDate = opts.targetDate;
  if (opts.priority !== undefined) input.priority = resolvePriority(opts.priority);
  if (opts.label) input.labelIds = await resolveProjectLabelIds(client, opts.label);
  if (opts.member) input.memberIds = await resolveMemberIds(client, opts.member);
  if (opts.icon) input.icon = opts.icon;
  if (opts.color) input.color = opts.color;

  if (Object.keys(input).length === 0)
    throw usageError("Nothing to update; pass at least one field.");
  return unwrapMutation(
    withRetry(() => client.updateProject(projectId, input as any)),
    "project",
    "Project update",
  );
}

export async function archiveProject(client: LinearClient, idArg: string) {
  const projectId = await resolveProjectId(client, idArg);
  const project = await withRetry(() => client.project(projectId));
  await assertMutation(
    withRetry(() => client.archiveProject(projectId)),
    "Project archive",
  );
  return project;
}

/**
 * Trash a project (`projectDelete`). Distinct from `archiveProject`: an
 * archived project stays in the workspace, read-only; a trashed one is gone
 * from every list and is purged after Linear's grace period. Returns the
 * project as it was, for the receipt.
 */
export async function deleteProject(client: LinearClient, idArg: string) {
  const projectId = await resolveProjectId(client, idArg);
  const project = await withRetry(() => client.project(projectId));
  await assertMutation(
    withRetry(() => client.deleteProject(projectId)),
    "Project deletion",
  );
  return project;
}

export interface MilestoneRow {
  id: string;
  name: string;
  targetDate: string | null;
  progress: number | null;
}

/** `project milestones` rows; checked against this file's `MilestoneRow`. */
export const PROJECT_MILESTONE_ROW_SHAPE = shape<MilestoneRow>({
  id: "string",
  name: "string",
  targetDate: "string|null",
  progress: "number|null",
});

export async function listMilestones(
  client: LinearClient,
  idArg: string,
  limit: number,
): Promise<MilestoneRow[]> {
  const projectId = await resolveProjectId(client, idArg);
  const project = await withRetry(() => client.project(projectId));
  const conn = await withRetry(() => project.projectMilestones({ first: pageSize(limit) }));
  const nodes = await collect(conn as any, limit);
  return inheritPaginationMetadata(
    nodes.map((m: any) => ({
      id: m.id,
      name: m.name,
      targetDate: m.targetDate ?? null,
      progress: m.progress ?? null,
    })),
    nodes,
  );
}

export interface UpdateRow {
  id: string;
  createdAt: string;
  user: string;
  body: string;
  health: string | null;
}

export async function listUpdates(
  client: LinearClient,
  idArg: string,
  limit: number,
): Promise<UpdateRow[]> {
  const projectId = await resolveProjectId(client, idArg);
  const project = await withRetry(() => client.project(projectId));
  const conn = await withRetry(() => project.projectUpdates({ first: pageSize(limit) }));
  const nodes = await collect(conn as any, limit);
  return inheritPaginationMetadata(
    await Promise.all(
      nodes.map(async (u: any) => {
        const user = await u.user;
        return {
          id: u.id,
          createdAt: u.createdAt?.toISOString?.() ?? String(u.createdAt),
          user: user?.displayName ?? "unknown",
          body: u.body ?? "",
          health: u.health ?? null,
        };
      }),
    ),
    nodes,
  );
}

/** Resolve one or more team references (key/name/id) to team ids; default when none. */
/** Validate a project priority (same 0-4 scale as issues). */
export function resolvePriority(input: number): number {
  if (!Number.isInteger(input) || input < 0 || input > 4)
    throw usageError(
      `Invalid priority '${input}'. Valid: 0 (none), 1 (urgent), 2 (high), 3 (medium), 4 (low).`,
    );
  return input;
}

/** Resolve project members (me|email|name|id), deduplicated. */
async function resolveMemberIds(client: LinearClient, members: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const m of members) ids.push(await resolveUserId(client, m));
  return [...new Set(ids)];
}

async function resolveTeamIds(
  client: LinearClient,
  teams: string[] | undefined,
  defaultTeamKey: string | undefined,
): Promise<string[]> {
  const inputs = teams?.length ? teams : defaultTeamKey ? [defaultTeamKey] : [];
  if (inputs.length === 0) {
    throw usageError("No team specified. Pass --team <KEY> or set a default team in config.");
  }
  const ids: string[] = [];
  for (const t of inputs) {
    ids.push((await resolveTeam(client, t, undefined)).id);
  }
  return ids;
}

/** Resolve a project status (by name or type) to a status id. */
async function resolveStatusId(client: LinearClient, input: string): Promise<string> {
  if (isUuid(input)) return input;
  const conn = await withRetry(() => client.projectStatuses({ first: 250 }));
  const statuses = (await collect(conn as any, Infinity)) as Array<{
    id: string;
    name: string;
    type: string;
  }>;
  const lower = input.toLowerCase();
  const byName = statuses.filter((s) => s.name.toLowerCase() === lower);
  const matches = byName.length ? byName : statuses.filter((s) => s.type.toLowerCase() === lower);
  if (matches.length === 0)
    throw notFound(
      `No project status '${input}'. Available: ${statuses.map((s) => s.name).join(", ")}`,
    );
  if (matches.length > 1)
    throw ambiguous(
      `Multiple project statuses match '${input}': ${matches.map((s) => s.name).join(", ")}`,
    );
  return matches[0]!.id;
}
