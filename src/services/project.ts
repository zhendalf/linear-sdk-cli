/**
 * Project service: all SDK access for projects lives here so commands stay thin.
 *
 * Lists use a tailored GraphQL query (one round-trip, no N+1 on status/lead);
 * single `view`, milestones, updates and all mutations use the typed SDK models.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { collect, collectRawQuery } from "../lib/pagination.js";
import { usageError, notFound, ambiguous } from "../lib/errors.js";
import { resolveTeam, resolveUserId, resolveProjectId, isUuid } from "../lib/resolve.js";

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

export interface ListFilters {
  team?: string;
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
  const teamKey = f.team ?? defaultTeamKey;
  if (teamKey) {
    filter.accessibleTeams = { some: { key: { eq: teamKey.toUpperCase() } } };
  }
  if (f.state) {
    // `state` is the project's status group (e.g. planned/started/completed).
    filter.state = { eq: f.state };
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

export interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  state: string | null;
  status: string | null;
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
  lead: string | null;
  teams: string[];
  members: string[];
}

export async function getProjectDetail(client: LinearClient, idArg: string): Promise<ProjectDetail> {
  const projectId = await resolveProjectId(client, idArg);
  const project = await withRetry(() => client.project(projectId));
  const [status, lead, teams, members] = await Promise.all([
    project.status,
    project.lead,
    project.teams(),
    project.members(),
  ]);
  return {
    id: project.id,
    name: project.name,
    description: project.description || null,
    state: project.state ?? null,
    status: status?.name ?? null,
    health: project.health ?? null,
    progress: project.progress ?? null,
    priority: project.priority,
    priorityLabel: project.priorityLabel,
    url: project.url,
    startDate: project.startDate ?? null,
    targetDate: project.targetDate ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    completedAt: project.completedAt ? project.completedAt.toISOString() : null,
    lead: lead?.displayName ?? null,
    teams: teams.nodes.map((t) => `${t.key} ${t.name}`),
    members: members.nodes.map((m) => m.displayName),
  };
}

export interface CreateOptions {
  name: string;
  description?: string;
  team?: string[];
  lead?: string;
  state?: string;
  startDate?: string;
  targetDate?: string;
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
  if (opts.state) input.statusId = await resolveStatusId(client, opts.state);
  if (opts.lead) input.leadId = await resolveUserId(client, opts.lead);
  if (opts.startDate) input.startDate = opts.startDate;
  if (opts.targetDate) input.targetDate = opts.targetDate;

  const payload = await withRetry(() => client.createProject(input as any));
  const project = await payload.project;
  if (!project) throw usageError("Project creation returned no project.");
  return project;
}

export interface UpdateOptions {
  name?: string;
  description?: string;
  team?: string[];
  lead?: string;
  state?: string;
  startDate?: string;
  targetDate?: string;
}

export async function updateProject(client: LinearClient, idArg: string, opts: UpdateOptions) {
  const projectId = await resolveProjectId(client, idArg);
  const input: Record<string, any> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.team?.length) input.teamIds = await resolveTeamIds(client, opts.team, undefined);
  if (opts.lead) input.leadId = await resolveUserId(client, opts.lead);
  if (opts.state) input.statusId = await resolveStatusId(client, opts.state);
  if (opts.startDate) input.startDate = opts.startDate;
  if (opts.targetDate) input.targetDate = opts.targetDate;

  if (Object.keys(input).length === 0)
    throw usageError("Nothing to update; pass at least one field.");
  const payload = await withRetry(() => client.updateProject(projectId, input as any));
  const project = await payload.project;
  if (!project) throw usageError("Project update returned no project.");
  return project;
}

export async function archiveProject(client: LinearClient, idArg: string) {
  const projectId = await resolveProjectId(client, idArg);
  const project = await withRetry(() => client.project(projectId));
  await withRetry(() => client.archiveProject(projectId));
  return project;
}

export interface MilestoneRow {
  id: string;
  name: string;
  targetDate: string | null;
  progress: number | null;
}

export async function listMilestones(
  client: LinearClient,
  idArg: string,
  limit: number,
): Promise<MilestoneRow[]> {
  const projectId = await resolveProjectId(client, idArg);
  const project = await withRetry(() => client.project(projectId));
  const conn = await withRetry(() =>
    project.projectMilestones({ first: Math.min(limit === Infinity ? 100 : limit, 100) }),
  );
  const nodes = await collect(conn as any, limit);
  return nodes.map((m: any) => ({
    id: m.id,
    name: m.name,
    targetDate: m.targetDate ?? null,
    progress: m.progress ?? null,
  }));
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
  const conn = await withRetry(() =>
    project.projectUpdates({ first: Math.min(limit === Infinity ? 100 : limit, 100) }),
  );
  const nodes = await collect(conn as any, limit);
  return Promise.all(
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
  );
}

/** Resolve one or more team references (key/name/id) to team ids; default when none. */
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
  const statuses = await withRetry(() => client.projectStatuses({ first: 100 }));
  const lower = input.toLowerCase();
  const byName = statuses.nodes.filter((s) => s.name.toLowerCase() === lower);
  const matches = byName.length
    ? byName
    : statuses.nodes.filter((s) => s.type.toLowerCase() === lower);
  if (matches.length === 0)
    throw notFound(
      `No project status '${input}'. Available: ${statuses.nodes.map((s) => s.name).join(", ")}`,
    );
  if (matches.length > 1)
    throw ambiguous(`Multiple project statuses match '${input}': ${matches.map((s) => s.name).join(", ")}`);
  return matches[0]!.id;
}
