/** Workspace project-status definitions. */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { ambiguous, notFound, usageError } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import { collect, inheritPaginationMetadata, pageSize } from "../lib/pagination.js";
import { isUuid } from "../lib/resolve.js";
import { shape } from "../lib/shape.js";

export const PROJECT_STATUS_TYPES = [
  "backlog",
  "planned",
  "started",
  "paused",
  "completed",
  "canceled",
] as const;
export type ProjectStatusType = (typeof PROJECT_STATUS_TYPES)[number];

export interface ProjectStatusRow {
  id: string;
  name: string;
  description: string | null;
  color: string;
  position: number;
  type: string;
  indefinite: boolean;
  archivedAt: string | null;
}

export const PROJECT_STATUS_ROW_SHAPE = shape<ProjectStatusRow>({
  id: "string",
  name: "string",
  description: "string|null",
  color: "string",
  position: "number",
  type: "string",
  indefinite: "boolean",
  archivedAt: "string|null",
});

export interface ProjectStatusDetail extends ProjectStatusRow {
  createdAt: string;
  updatedAt: string;
}

export const PROJECT_STATUS_DETAIL_SHAPE = shape<ProjectStatusDetail>({
  ...PROJECT_STATUS_ROW_SHAPE,
  createdAt: "string",
  updatedAt: "string",
});

export async function listProjectStatuses(
  client: LinearClient,
  limit: number,
  includeArchived = false,
): Promise<ProjectStatusRow[]> {
  const conn = await withRetry(() =>
    client.projectStatuses({ first: pageSize(limit), includeArchived }),
  );
  const nodes = await collect(conn as any, limit);
  return inheritPaginationMetadata(nodes.map(toRow).sort(compareStatuses), nodes);
}

export async function getProjectStatusDetail(
  client: LinearClient,
  input: string,
): Promise<ProjectStatusDetail> {
  const id = await resolveProjectStatusId(client, input, { includeArchived: true });
  const status = await withRetry(() => client.projectStatus(id));
  return {
    ...toRow(status),
    createdAt: toIso(status.createdAt),
    updatedAt: toIso(status.updatedAt),
  };
}

export interface ProjectStatusInput {
  name?: string;
  description?: string;
  color?: string;
  position?: number;
  type?: string;
  indefinite?: boolean;
}

export async function createProjectStatus(client: LinearClient, opts: ProjectStatusInput) {
  const input = buildInput(opts, true);
  return unwrapMutation(
    withRetry(() => client.createProjectStatus(input as any)),
    "status",
    "Project status creation",
  );
}

export async function updateProjectStatus(
  client: LinearClient,
  input: string,
  opts: ProjectStatusInput,
) {
  const id = await resolveProjectStatusId(client, input);
  const update = buildInput(opts, false);
  if (Object.keys(update).length === 0)
    throw usageError("Nothing to update; pass at least one project-status field.");
  return unwrapMutation(
    withRetry(() => client.updateProjectStatus(id, update as any)),
    "status",
    "Project status update",
  );
}

export async function archiveProjectStatus(client: LinearClient, input: string) {
  const id = await resolveProjectStatusId(client, input);
  const status = await withRetry(() => client.projectStatus(id));
  await assertMutation(
    withRetry(() => client.archiveProjectStatus(id)),
    "Project status archive",
  );
  return status;
}

export async function unarchiveProjectStatus(client: LinearClient, input: string) {
  const id = await resolveProjectStatusId(client, input, { includeArchived: true });
  const status = await withRetry(() => client.projectStatus(id));
  await assertMutation(
    withRetry(() => client.unarchiveProjectStatus(id)),
    "Project status unarchive",
  );
  return status;
}

/** Shared by project-status commands and project create/update --state. */
export async function resolveProjectStatusId(
  client: LinearClient,
  input: string,
  opts: { includeArchived?: boolean; allowType?: boolean } = {},
): Promise<string> {
  if (isUuid(input)) return input;
  const conn = await withRetry(() =>
    client.projectStatuses({ first: 250, includeArchived: opts.includeArchived === true }),
  );
  const statuses = (await collect(conn as any, Infinity)) as Array<{
    id: string;
    name: string;
    type: string;
    archivedAt?: unknown;
  }>;
  const exact = statuses.filter((s) => s.name === input);
  const insensitive = statuses.filter((s) => s.name.toLowerCase() === input.toLowerCase());
  let matches = exact.length ? exact : insensitive;
  if (matches.length === 0 && opts.allowType) {
    matches = statuses.filter((s) => s.type.toLowerCase() === input.toLowerCase());
  }
  if (matches.length === 0)
    throw notFound(
      `No project status matching '${input}'. Run 'linear project-status list${opts.includeArchived ? " --include-archived" : ""}' to see the options.`,
    );
  if (matches.length > 1)
    throw ambiguous(
      `Multiple project statuses match '${input}': ${matches.map((s) => `${s.name} (${s.id})`).join(", ")}. Pass the project status id instead.`,
    );
  return matches[0]!.id;
}

function buildInput(opts: ProjectStatusInput, create: boolean): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (opts.name !== undefined) {
    if (!opts.name.trim()) throw usageError("Project status name must not be empty.");
    input.name = opts.name;
  }
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.color !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(opts.color))
      throw usageError(
        `Invalid color '${opts.color}'. Expected a six-digit hex color such as #5E6AD2.`,
      );
    input.color = opts.color;
  }
  if (opts.position !== undefined) {
    if (!Number.isFinite(opts.position) || opts.position < 0)
      throw usageError("Project status position must be a non-negative number.");
    input.position = opts.position;
  }
  if (opts.type !== undefined) {
    if (!PROJECT_STATUS_TYPES.includes(opts.type as ProjectStatusType))
      throw usageError(
        `Invalid project status type '${opts.type}'. Valid: ${PROJECT_STATUS_TYPES.join(", ")}.`,
      );
    input.type = opts.type;
  }
  if (opts.indefinite !== undefined) input.indefinite = opts.indefinite;
  if (create) {
    const missing = ["name", "color", "position", "type"].filter((key) => !(key in input));
    if (missing.length)
      throw usageError(
        `Missing required project-status fields: ${missing.map((k) => `--${k}`).join(", ")}.`,
      );
  }
  return input;
}

function toRow(status: any): ProjectStatusRow {
  return {
    id: status.id,
    name: status.name,
    description: status.description ?? null,
    color: status.color,
    position: status.position,
    type: status.type,
    indefinite: status.indefinite === true,
    archivedAt: status.archivedAt ? toIso(status.archivedAt) : null,
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function compareStatuses(a: ProjectStatusRow, b: ProjectStatusRow): number {
  const type =
    PROJECT_STATUS_TYPES.indexOf(a.type as ProjectStatusType) -
    PROJECT_STATUS_TYPES.indexOf(b.type as ProjectStatusType);
  return type || a.position - b.position || a.name.localeCompare(b.name);
}
