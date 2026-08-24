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
import { shape } from "../lib/shape.js";
import {
  collect,
  inheritPaginationMetadata,
  pageSize,
  pageSizeForMore,
} from "../lib/pagination.js";
import { usageError, notFound } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import { resolveProjectId, resolveMilestoneId, isUuid } from "../lib/resolve.js";

export interface MilestoneRow {
  id: string;
  name: string;
  targetDate: string | null;
  progress: number;
  status: string;
  description: string | null;
}

/** The row's shape as `linear commands` advertises it (TES-610); checked against the interface. */
export const MILESTONE_ROW_SHAPE = shape<MilestoneRow>({
  id: "string",
  name: "string",
  targetDate: "string|null",
  progress: "number",
  status: "string",
  description: "string|null",
});

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
  const conn = await withRetry(() => project.projectMilestones({ first: pageSize(limit) }));
  const nodes = await collect(conn as any, limit);
  return inheritPaginationMetadata(nodes.map(toRow), nodes);
}

export interface MilestoneDetail {
  id: string;
  name: string;
  description: string | null;
  targetDate: string | null;
  progress: number;
  status: string;
  project: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  /** Issues assigned to this milestone, capped at `limit`. */
  issues: Array<{
    id: string;
    identifier: string;
    title: string;
    state: { id: string; name: string; type: string } | null;
  }>;
  /** True when the cap hid some issues, so the caller can say so out loud. */
  issuesTruncated: boolean;
}

/** The detail's shape; checked against `MilestoneDetail`. */
export const MILESTONE_DETAIL_SHAPE = shape<MilestoneDetail>({
  id: "string",
  name: "string",
  description: "string|null",
  targetDate: "string|null",
  progress: "number",
  status: "string",
  project: { nullable: { id: "string", name: "string" } },
  createdAt: "string",
  updatedAt: "string",
  issues: [
    {
      id: "string",
      identifier: "string",
      title: "string",
      state: { nullable: { id: "string", name: "string", type: "string" } },
    },
  ],
  issuesTruncated: "boolean",
});

/**
 * The milestone, its project and one page of its issues — with each issue's
 * state selected in place. The SDK-model version awaited `issue.state` per
 * issue, one request each: 16 requests for a 13-issue milestone, and `-n 50`
 * on a full one cost ~53. The page size is `$first`; the milestone fields
 * ride along on every page and are read off the first.
 */
const DETAIL_QUERY = `
query CliMilestoneDetail($id: String!, $first: Int!, $after: String) {
  projectMilestone(id: $id) {
    id name description targetDate progress status createdAt updatedAt
    project { id name }
    issues(first: $first, after: $after) {
      nodes { id identifier title state { id name type } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/**
 * Milestone detail plus the issues it contains, capped at `limit` (the global
 * `-n/--limit`, or all of them under `--all`). `issuesTruncated` lets the caller
 * say so out loud instead of quietly showing a partial list.
 */
export async function getMilestoneDetail(
  client: LinearClient,
  id: string,
  limit = 50,
): Promise<MilestoneDetail> {
  const raw = (vars: Record<string, unknown>): Promise<{ data: any }> =>
    (client as any).client.rawRequest(DETAIL_QUERY, vars);
  // One extra issue is requested so truncation is a fact we hold, not a guess:
  // the sentinel item is what tells "the last one fit" from "there is one more".
  const want = limit === Infinity ? Infinity : limit + 1;
  const first = pageSizeForMore(limit);
  const page = await withRetry(() => raw({ id, first, after: undefined }));
  const m = page.data?.projectMilestone;
  if (!m) throw notFound(`No milestone ${id}.`);
  const nodes: any[] = [...(m.issues?.nodes ?? [])];
  let pageInfo = m.issues?.pageInfo ?? { hasNextPage: false };
  while (nodes.length < want && pageInfo.hasNextPage) {
    const after = pageInfo.endCursor;
    const next = await withRetry(() => raw({ id, first, after }));
    const conn = next.data?.projectMilestone?.issues;
    if (!conn) break;
    nodes.push(...conn.nodes);
    pageInfo = conn.pageInfo;
  }
  const hasMore = nodes.length > limit;
  return {
    id: m.id,
    name: m.name,
    description: m.description ?? null,
    targetDate: m.targetDate ?? null,
    progress: m.progress ?? 0,
    status: m.status ?? "",
    project: m.project ?? null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    issues: nodes.slice(0, limit).map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      state: i.state ?? null,
    })),
    // We know only that more exist, never how many.
    issuesTruncated: hasMore,
  };
}

/**
 * A milestone reference as `view`/`update`/`delete` take it: a UUID, or a name
 * plus the project it lives in. Milestone names are unique only within a
 * project, so a bare name has nothing to resolve against — the same rule
 * `issue update --milestone` applies, where the scope is the issue's project
 * or `--project`. Without a scope the error says what to pass, rather than the
 * API's "Could not find referenced ProjectMilestone" for a name it never tried
 * to match.
 */
export async function resolveMilestoneRef(
  client: LinearClient,
  input: string,
  projectInput: string | undefined,
): Promise<string> {
  if (isUuid(input)) return input;
  if (!projectInput) {
    throw usageError(
      `'${input}' is not a milestone id; pass --project <name|id> to look a milestone up by name.`,
    );
  }
  const projectId = await resolveProjectId(client, projectInput);
  return resolveMilestoneId(client, projectId, input);
}

/** The SDK model for a milestone id (mutations need the model's id only, but the name for the receipt). */
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

  return unwrapMutation(
    withRetry(() => client.createProjectMilestone(input as any)),
    "projectMilestone",
    "Milestone creation",
  );
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
  return unwrapMutation(
    withRetry(() => client.updateProjectMilestone(milestone.id, input as any)),
    "projectMilestone",
    "Milestone update",
  );
}

export async function deleteMilestone(client: LinearClient, id: string) {
  const milestone = await resolveMilestone(client, id);
  await assertMutation(
    withRetry(() => client.deleteProjectMilestone(milestone.id)),
    "Milestone deletion",
  );
  return milestone;
}
