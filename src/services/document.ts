/**
 * Document service: all SDK access for documents lives here so commands stay thin.
 *
 * The list uses a tailored GraphQL query (one round-trip, no N+1 on the related
 * project name); the single `view` and all mutations use the typed SDK models.
 * Mutations unwrap the `{ success, document }` payload.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { collectRawQuery } from "../lib/pagination.js";
import { usageError, notFound } from "../lib/errors.js";
import { resolveProjectId, resolveIssue, resolveTeam, isUuid } from "../lib/resolve.js";

export interface DocumentRow {
  id: string;
  title: string;
  url: string;
  updatedAt: string;
  project: { name: string } | null;
}

const LIST_QUERY = `
query CliDocuments($filter: DocumentFilter, $first: Int!, $after: String, $includeArchived: Boolean) {
  documents(filter: $filter, first: $first, after: $after, includeArchived: $includeArchived) {
    nodes {
      id title url updatedAt
      project { name }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export interface ListFilters {
  /** Container project, by name or id. */
  project?: string;
  /** Container issue, by identifier (TES-1) or id. */
  issue?: string;
}

/**
 * List workspace documents (most-recently updated come from the API order),
 * optionally narrowed to a container. DocumentFilter matches containers by id,
 * so a human `--issue TES-1` is resolved to the issue first.
 */
export async function listDocuments(
  client: LinearClient,
  limit: number,
  filters: ListFilters = {},
): Promise<DocumentRow[]> {
  const filter: Record<string, any> = {};
  if (filters.project) {
    filter.project = { id: { eq: await resolveProjectId(client, filters.project) } };
  }
  if (filters.issue) {
    filter.issue = { id: { eq: (await resolveIssue(client, filters.issue)).id } };
  }
  return collectRawQuery<DocumentRow>(
    client as any,
    LIST_QUERY,
    {
      filter: Object.keys(filter).length ? filter : undefined,
      includeArchived: false,
    },
    "documents",
    limit,
    (n) => ({
      id: n.id,
      title: n.title,
      url: n.url,
      updatedAt: n.updatedAt,
      project: n.project ?? null,
    }),
  );
}

export interface DocumentDetail {
  id: string;
  title: string;
  content: string | null;
  url: string;
  slugId: string;
  icon: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  project: string | null;
  issue: string | null;
  creator: string | null;
}

export async function getDocumentDetail(
  client: LinearClient,
  idArg: string,
): Promise<DocumentDetail> {
  const document = await resolveDocument(client, idArg);
  const [project, issue, creator] = await Promise.all([
    document.project,
    document.issue,
    document.creator,
  ]);
  return {
    id: document.id,
    title: document.title,
    content: document.content ?? null,
    url: document.url,
    slugId: document.slugId,
    icon: document.icon ?? null,
    color: document.color ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    project: project?.name ?? null,
    issue: issue?.identifier ?? null,
    creator: creator?.displayName ?? null,
  };
}

export interface CreateOptions {
  title: string;
  content?: string;
  /** Container references — exactly one is required by the API. */
  project?: string;
  issue?: string;
  team?: string;
}

/**
 * Build a DocumentCreateInput. Linear requires exactly one container
 * (project / issue / team / …); we resolve the first one supplied, in priority
 * order project > issue > team, and error if none is given.
 */
export async function createDocument(client: LinearClient, opts: CreateOptions) {
  const input: Record<string, any> = { title: opts.title };
  if (opts.content !== undefined) input.content = opts.content;

  // Linear requires EXACTLY one container — guard against zero or multiple.
  const containers = [opts.project, opts.issue, opts.team].filter(Boolean);
  if (containers.length === 0) {
    throw usageError("A document needs a container: pass --project, --issue, or --team.");
  }
  if (containers.length > 1) {
    throw usageError("A document can have only one container; pass just one of --project/--issue/--team.");
  }

  if (opts.project) {
    input.projectId = await resolveProjectId(client, opts.project);
  } else if (opts.issue) {
    input.issueId = (await resolveIssue(client, opts.issue)).id;
  } else {
    input.teamId = (await resolveTeam(client, opts.team!, undefined)).id;
  }

  const payload = await withRetry(() => client.createDocument(input as any));
  const document = await payload.document;
  if (!document) throw usageError("Document creation returned no document.");
  return document;
}

export interface UpdateOptions {
  title?: string;
  content?: string;
}

export async function updateDocument(
  client: LinearClient,
  idArg: string,
  opts: UpdateOptions,
) {
  const document = await resolveDocument(client, idArg);
  const input: Record<string, any> = {};
  if (opts.title !== undefined) input.title = opts.title;
  if (opts.content !== undefined) input.content = opts.content;

  if (Object.keys(input).length === 0)
    throw usageError("Nothing to update; pass at least one of --title, --content.");

  const payload = await withRetry(() => client.updateDocument(document.id, input as any));
  const updated = await payload.document;
  if (!updated) throw usageError("Document update returned no document.");
  return updated;
}

export async function deleteDocument(client: LinearClient, idArg: string) {
  const document = await resolveDocument(client, idArg);
  await withRetry(() => client.deleteDocument(document.id));
  return document;
}

/**
 * Resolve a document by id. A UUID is fetched directly; a slugId is matched
 * against the workspace documents (the API also accepts a slugId on the lookup,
 * but we normalize to the typed model for consistent unwrapping).
 */
async function resolveDocument(client: LinearClient, idArg: string) {
  if (isUuid(idArg)) return withRetry(() => client.document(idArg));
  // The SDK's document() also resolves a slugId; fall back to it directly.
  try {
    return await withRetry(() => client.document(idArg));
  } catch {
    throw notFound(`No document matching '${idArg}'.`);
  }
}
