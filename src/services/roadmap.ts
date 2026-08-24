/**
 * Roadmap service: all SDK access for roadmaps lives here so commands stay thin.
 *
 * Roadmaps are workspace-level and relatively few, so the list uses the typed
 * SDK connection (paginated via collect()); single `view`, its associated
 * projects, and all mutations use the typed SDK models. Mutations return SDK
 * payloads ({ success, roadmap }) — we await and unwrap the entity.
 *
 * There is no RoadmapFilter in the SDK, so name lookups match client-side
 * against the (small) set of workspace roadmaps.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { shape } from "../lib/shape.js";
import { collect, inheritPaginationMetadata, pageSize } from "../lib/pagination.js";
import { usageError, notFound, ambiguous } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import { resolveUserId, isUuid } from "../lib/resolve.js";

export interface RoadmapRow {
  id: string;
  name: string;
  description: string | null;
  url: string;
}

/** The row's shape as `linear commands` advertises it (TES-610); checked against the interface. */
export const ROADMAP_ROW_SHAPE = shape<RoadmapRow>({
  id: "string",
  name: "string",
  description: "string|null",
  url: "string",
});

/** Project a Roadmap SDK model to a table row. Exported for tests. */
export function toRow(r: any): RoadmapRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    url: r.url,
  };
}

export async function listRoadmaps(client: LinearClient, limit: number): Promise<RoadmapRow[]> {
  const conn = await withRetry(() => client.roadmaps({ first: pageSize(limit) }));
  const nodes = await collect(conn as any, limit);
  return inheritPaginationMetadata(nodes.map(toRow), nodes);
}

export interface RoadmapDetail {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  url: string;
  slugId: string;
  owner: string | null;
  creator: string | null;
  createdAt: string;
  updatedAt: string;
  projects: string[];
}

/** The detail's shape; checked against `RoadmapDetail`. */
export const ROADMAP_DETAIL_SHAPE = shape<RoadmapDetail>({
  id: "string",
  name: "string",
  description: "string|null",
  color: "string|null",
  url: "string",
  slugId: "string",
  owner: "string|null",
  creator: "string|null",
  createdAt: "string",
  updatedAt: "string",
  projects: ["string"],
});

export async function getRoadmapDetail(
  client: LinearClient,
  idArg: string,
): Promise<RoadmapDetail> {
  const roadmap = await resolveRoadmap(client, idArg);
  const [owner, creator, projects] = await Promise.all([
    roadmap.owner,
    roadmap.creator,
    withRetry(() => roadmap.projects({ first: 100 })),
  ]);
  const projectConn = projects as { nodes: Array<{ name: string }> };
  return {
    id: roadmap.id,
    name: roadmap.name,
    description: roadmap.description ?? null,
    color: roadmap.color ?? null,
    url: roadmap.url,
    slugId: roadmap.slugId,
    owner: owner?.displayName ?? null,
    creator: creator?.displayName ?? null,
    createdAt: roadmap.createdAt.toISOString(),
    updatedAt: roadmap.updatedAt.toISOString(),
    projects: projectConn.nodes.map((p) => p.name),
  };
}

export interface CreateOptions {
  name: string;
  description?: string;
  owner?: string;
  color?: string;
}

/** Build a RoadmapCreateInput, resolving the owner reference to a user id. */
export async function createRoadmap(client: LinearClient, opts: CreateOptions) {
  const input: Record<string, any> = { name: opts.name };
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.owner) input.ownerId = await resolveUserId(client, opts.owner);
  if (opts.color) input.color = opts.color;

  return unwrapMutation(
    withRetry(() => client.createRoadmap(input as any)),
    "roadmap",
    "Roadmap creation",
  );
}

export interface UpdateOptions {
  name?: string;
  description?: string;
  owner?: string;
  color?: string;
}

export async function updateRoadmap(client: LinearClient, idArg: string, opts: UpdateOptions) {
  const roadmap = await resolveRoadmap(client, idArg);
  const input: Record<string, any> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.owner) input.ownerId = await resolveUserId(client, opts.owner);
  if (opts.color) input.color = opts.color;

  if (Object.keys(input).length === 0)
    throw usageError("Nothing to update; pass at least one field.");
  return unwrapMutation(
    withRetry(() => client.updateRoadmap(roadmap.id, input as any)),
    "roadmap",
    "Roadmap update",
  );
}

export async function deleteRoadmap(client: LinearClient, idArg: string) {
  const roadmap = await resolveRoadmap(client, idArg);
  await assertMutation(
    withRetry(() => client.deleteRoadmap(roadmap.id)),
    "Roadmap deletion",
  );
  return roadmap;
}

/**
 * Resolve a roadmap by id (UUID, fetched directly) or by name. The `roadmaps`
 * query takes no filter argument in @linear/sdk v87, so matching is client-side
 * — but we exhaust pagination (via collect) so a match past the first page is
 * not missed.
 */
async function resolveRoadmap(client: LinearClient, idArg: string) {
  if (isUuid(idArg)) return withRetry(() => client.roadmap(idArg));
  const conn = await withRetry(() => client.roadmaps({ first: 100 }));
  const all = await collect<any>(conn as any, Infinity);
  const lower = idArg.toLowerCase();
  const matches = all.filter((r: any) => r.name.toLowerCase() === lower);
  if (matches.length === 0) throw notFound(`No roadmap matching '${idArg}'.`);
  if (matches.length > 1)
    throw ambiguous(`Multiple roadmaps match '${idArg}'; pass the roadmap id instead.`);
  return matches[0]!;
}
