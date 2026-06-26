/**
 * Project-milestone service: all SDK access for project milestones lives here so
 * commands stay thin.
 *
 * Milestones are always scoped to a project. Lists go through the project's
 * `projectMilestones` connection (paginated); single `view` and all mutations
 * use the typed SDK models. Mutations return SDK payloads ({ success,
 * projectMilestone }) — we await and unwrap the entity.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { collect } from "../lib/pagination.js";
import { usageError } from "../lib/errors.js";
import { resolveProjectId } from "../lib/resolve.js";

export interface MilestoneRow {
  id: string;
  name: string;
  targetDate: string | null;
  progress: number;
  status: string;
  description: string | null;
}

/** Project a ProjectMilestone (SDK model or raw node) to a table row. Exported for tests. */
export function toRow(m: any): MilestoneRow {
  return {
    id: m.id,
    name: m.name,
    targetDate: m.targetDate ?? null,
    progress: m.progress ?? 0,
    status: m.status ?? "",
    description: m.description ?? null,
  };
}

export async function listMilestones(
  client: LinearClient,
  projectInput: string,
  limit: number,
): Promise<MilestoneRow[]> {
  const projectId = await resolveProjectId(client, projectInput);
  const project = await withRetry(() => client.project(projectId));
  const conn = await withRetry(() =>
    project.projectMilestones({ first: limit === Infinity ? 100 : Math.min(limit, 100) }),
  );
  const nodes = await collect(conn as any, limit);
  return nodes.map(toRow);
}

export interface MilestoneDetail {
  id: string;
  name: string;
  description: string | null;
  targetDate: string | null;
  progress: number;
  status: string;
  project: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getMilestoneDetail(
  client: LinearClient,
  id: string,
): Promise<MilestoneDetail> {
  const milestone = await resolveMilestone(client, id);
  const project = await milestone.project;
  return {
    id: milestone.id,
    name: milestone.name,
    description: milestone.description ?? null,
    targetDate: milestone.targetDate ?? null,
    progress: milestone.progress ?? 0,
    status: (milestone as any).status ?? "",
    project: project?.name ?? null,
    createdAt: milestone.createdAt.toISOString(),
    updatedAt: milestone.updatedAt.toISOString(),
  };
}

/**
 * Resolve a milestone by id. A bare name cannot be resolved without a project
 * scope, so `view`/`update`/`delete` take an id (or a name pre-resolved against
 * a project via resolveMilestoneId).
 */
async function resolveMilestone(client: LinearClient, id: string) {
  return withRetry(() => client.projectMilestone(id));
}

export interface CreateOptions {
  name: string;
  description?: string;
  targetDate?: string;
}

/** Build a ProjectMilestoneCreateInput; the milestone is scoped to a project. */
export async function createMilestone(
  client: LinearClient,
  projectInput: string,
  opts: CreateOptions,
) {
  const projectId = await resolveProjectId(client, projectInput);
  const input: Record<string, any> = { projectId, name: opts.name };
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.targetDate) input.targetDate = opts.targetDate;

  const payload = await withRetry(() => client.createProjectMilestone(input as any));
  const milestone = await payload.projectMilestone;
  if (!milestone) throw usageError("Milestone creation returned no milestone.");
  return milestone;
}

export interface UpdateOptions {
  name?: string;
  description?: string;
  targetDate?: string;
}

export async function updateMilestone(client: LinearClient, id: string, opts: UpdateOptions) {
  const milestone = await resolveMilestone(client, id);
  const input: Record<string, any> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.targetDate !== undefined) input.targetDate = opts.targetDate;

  if (Object.keys(input).length === 0)
    throw usageError("Nothing to update; pass at least one field.");
  const payload = await withRetry(() => client.updateProjectMilestone(milestone.id, input as any));
  return (await payload.projectMilestone) ?? milestone;
}

export async function deleteMilestone(client: LinearClient, id: string) {
  const milestone = await resolveMilestone(client, id);
  await withRetry(() => client.deleteProjectMilestone(milestone.id));
  return milestone;
}
