/**
 * Document service: all SDK access for documents lives here so commands stay thin.
 *
 * A Linear document is attached to exactly one *target* — a project, issue,
 * initiative, team, cycle or release (`DocumentCreateInput` carries the six
 * ids; the API enforces "exactly one"). This module owns the CLI side of that
 * rule — parsing the six flags, resolving the one that is set, and mapping it
 * onto the create/update input or the list filter — so `create`, `update` and
 * `list` cannot drift apart. `update` re-points: setting a new target makes the
 * server clear the old one (verified live for every pair).
 *
 * The list and the detail use tailored GraphQL queries: the SDK's `Document`
 * model exposes no `team` or `cycle` getter (both are `[Internal]` in the
 * schema, though they work with a plain API key), and one round-trip beats six
 * lazy fetches. Mutations use the typed SDK models and unwrap the
 * `{ success, document }` payload.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { collectRawQuery } from "../lib/pagination.js";
import { usageError, notFound } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import {
  resolveProjectId,
  resolveIssue,
  resolveTeam,
  resolveCycleId,
  resolveReleaseId,
  isUuid,
} from "../lib/resolve.js";
import { resolveInitiative } from "./initiative.js";

// --- Targets ----------------------------------------------------------------

/** The six target flags as the user typed them (names, keys, identifiers, or ids). */
export interface DocumentTargetOptions {
  project?: string;
  issue?: string;
  initiative?: string;
  /** A team key — the target itself, or, together with `cycle`, the team the cycle is looked up in. */
  team?: string;
  cycle?: string;
  release?: string;
}

export type DocumentTargetKind = "project" | "issue" | "initiative" | "team" | "cycle" | "release";

/** One resolved target: which kind, and the entity's UUID. */
export interface DocumentTarget {
  kind: DocumentTargetKind;
  id: string;
}

const TARGET_FLAGS = "--project, --issue, --initiative, --team, --cycle, or --release";

/**
 * Which one target the flags name, before any network work. `--team` together
 * with `--cycle` scopes the cycle lookup (cycle numbers restart per team) and
 * does not count as a second target — the same reading the reference CLI has.
 * Two targets is a usage error whatever the command: a document has one, and a
 * list filtered by two could never match.
 */
export function selectTarget(
  o: DocumentTargetOptions,
): { kind: DocumentTargetKind; value: string; team?: string } | undefined {
  const picked: Array<{ kind: DocumentTargetKind; value: string; team?: string }> = [];
  if (o.project != null) picked.push({ kind: "project", value: o.project });
  if (o.issue != null) picked.push({ kind: "issue", value: o.issue });
  if (o.initiative != null) picked.push({ kind: "initiative", value: o.initiative });
  if (o.cycle != null) picked.push({ kind: "cycle", value: o.cycle, team: o.team });
  else if (o.team != null) picked.push({ kind: "team", value: o.team });
  if (o.release != null) picked.push({ kind: "release", value: o.release });
  if (picked.length > 1) {
    throw usageError(
      `A document has one target; got ${picked.map((p) => `--${p.kind}`).join(" and ")}. Pass exactly one of ${TARGET_FLAGS}.`,
    );
  }
  return picked[0];
}

/**
 * Resolve the selected target to its id. `defaultTeamKey` is the configured
 * team, used only to scope a `--cycle` lookup when `--team` was not given.
 */
export async function resolveTarget(
  client: LinearClient,
  sel: NonNullable<ReturnType<typeof selectTarget>>,
  defaultTeamKey: string | undefined,
): Promise<DocumentTarget> {
  switch (sel.kind) {
    case "project":
      return { kind: "project", id: await resolveProjectId(client, sel.value) };
    case "issue":
      return { kind: "issue", id: (await resolveIssue(client, sel.value)).id };
    case "initiative":
      return { kind: "initiative", id: (await resolveInitiative(client, sel.value)).id };
    case "team":
      return { kind: "team", id: (await resolveTeam(client, sel.value, undefined)).id };
    case "cycle": {
      const teamKey = sel.team ?? defaultTeamKey;
      if (!teamKey)
        throw usageError("--cycle needs a team to look the cycle up in: pass --team <KEY> or set a default team.");
      const team = await resolveTeam(client, teamKey, undefined);
      return { kind: "cycle", id: await resolveCycleId(client, team.id, sel.value) };
    }
    case "release":
      return { kind: "release", id: await resolveReleaseId(client, sel.value) };
  }
}

/** The one `…Id` field of DocumentCreateInput / DocumentUpdateInput a target sets. */
export function targetInput(t: DocumentTarget): Record<string, string> {
  return { [`${t.kind}Id`]: t.id };
}

/** The one relation clause of DocumentFilter a target filters by. */
export function targetFilter(t: DocumentTarget): Record<string, unknown> {
  return { [t.kind]: { id: { eq: t.id } } };
}

// --- Rows and detail --------------------------------------------------------

/**
 * A document's target relations, one of which is set. Objects (not display
 * strings) with ids, the same shapes the issue/project rows use, so a script
 * reads `.issue.identifier` / `.team.key` here as it does anywhere else.
 */
export interface DocumentTargets {
  project: { id: string; name: string } | null;
  issue: { id: string; identifier: string } | null;
  initiative: { id: string; name: string } | null;
  team: { id: string; key: string; name: string } | null;
  cycle: { id: string; number: number; name: string | null } | null;
  release: { id: string; name: string; version: string | null } | null;
}

export interface DocumentRow extends DocumentTargets {
  id: string;
  title: string;
  url: string;
  updatedAt: string;
}

/** The target selection every document query makes, so row and detail agree. */
const TARGET_FIELDS = `
      project { id name }
      issue { id identifier }
      initiative { id name }
      team { id key name }
      cycle { id number name }
      release { id name version }`;

const LIST_QUERY = `
query CliDocuments($filter: DocumentFilter, $first: Int!, $after: String, $includeArchived: Boolean) {
  documents(filter: $filter, first: $first, after: $after, includeArchived: $includeArchived) {
    nodes {
      id title url updatedAt${TARGET_FIELDS}
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** The target relations off a raw document node, absent ones nulled. */
function targets(n: any): DocumentTargets {
  return {
    project: n.project ?? null,
    issue: n.issue ?? null,
    initiative: n.initiative ?? null,
    team: n.team ?? null,
    cycle: n.cycle ? { id: n.cycle.id, number: n.cycle.number, name: n.cycle.name ?? null } : null,
    release: n.release ? { id: n.release.id, name: n.release.name, version: n.release.version ?? null } : null,
  };
}

/**
 * One line naming a document's target, typed — the six come from six
 * namespaces, so a bare name would be ambiguous. Shared by the list column and
 * the detail view.
 */
export function describeTarget(t: DocumentTargets): string | null {
  if (t.project) return `Project: ${t.project.name}`;
  if (t.issue) return `Issue: ${t.issue.identifier}`;
  if (t.initiative) return `Initiative: ${t.initiative.name}`;
  if (t.team) return `Team: ${t.team.key} ${t.team.name}`;
  if (t.cycle) return `Cycle: #${t.cycle.number}${t.cycle.name ? ` ${t.cycle.name}` : ""}`;
  if (t.release) return `Release: ${t.release.name}${t.release.version ? ` (${t.release.version})` : ""}`;
  return null;
}

/**
 * List workspace documents (most-recently updated come from the API order),
 * optionally narrowed to one target. DocumentFilter matches targets by id, so a
 * human `--issue TES-1` / `--project Roadmap` is resolved first.
 */
export async function listDocuments(
  client: LinearClient,
  limit: number,
  filters: DocumentTargetOptions = {},
  defaultTeamKey?: string,
): Promise<DocumentRow[]> {
  const sel = selectTarget(filters);
  const filter = sel ? targetFilter(await resolveTarget(client, sel, defaultTeamKey)) : undefined;
  return collectRawQuery<DocumentRow>(
    client as any,
    LIST_QUERY,
    { filter, includeArchived: false },
    "documents",
    limit,
    (n) => ({ id: n.id, title: n.title, url: n.url, updatedAt: n.updatedAt, ...targets(n) }),
  );
}

export interface DocumentDetail extends DocumentTargets {
  id: string;
  title: string;
  content: string | null;
  url: string;
  slugId: string;
  icon: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  creator: { id: string; displayName: string } | null;
}

/** `document(id:)` takes a UUID or a slugId, so either is one request. */
const DETAIL_QUERY = `
query CliDocumentDetail($id: String!) {
  document(id: $id) {
    id title content url slugId icon color createdAt updatedAt
    creator { id displayName }${TARGET_FIELDS}
  }
}`;

export async function getDocumentDetail(client: LinearClient, idArg: string): Promise<DocumentDetail> {
  // An unknown id is an API error ("Could not find referenced Document"), which
  // the error boundary already reads as not-found (exit 3); a null is guarded too.
  const data: any = await withRetry(() => (client as any).client.rawRequest(DETAIL_QUERY, { id: idArg }));
  const n = data?.data?.document;
  if (!n) throw notFound(`No document matching '${idArg}'.`);
  return {
    id: n.id,
    title: n.title,
    content: n.content ?? null,
    url: n.url,
    slugId: n.slugId,
    icon: n.icon ?? null,
    color: n.color ?? null,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    creator: n.creator ?? null,
    ...targets(n),
  };
}

// --- Mutations ----------------------------------------------------------------

export interface CreateOptions extends DocumentTargetOptions {
  title: string;
  content?: string;
}

/**
 * Build a DocumentCreateInput. Exactly one target is required — an error names
 * the six flags when none (or two) are given. The configured default team is
 * NOT a fallback here: the command decides that, so the service never turns
 * "no target" into "the team from config" behind the caller's back.
 */
export async function createDocument(client: LinearClient, opts: CreateOptions, defaultTeamKey?: string) {
  const sel = selectTarget(opts);
  if (!sel) throw usageError(`A document needs a target: pass one of ${TARGET_FLAGS}.`);
  const input: Record<string, any> = { title: opts.title };
  if (opts.content !== undefined) input.content = opts.content;
  Object.assign(input, targetInput(await resolveTarget(client, sel, defaultTeamKey)));

  return unwrapMutation(
    withRetry(() => client.createDocument(input as any)),
    "document",
    "Document creation",
  );
}

export interface UpdateOptions extends DocumentTargetOptions {
  title?: string;
  content?: string;
}

/**
 * Update a document: title, content, and/or re-point it to a new target (which
 * clears the old one). At most one target; none means a metadata-only edit.
 */
export async function updateDocument(
  client: LinearClient,
  idArg: string,
  opts: UpdateOptions,
  defaultTeamKey?: string,
) {
  // Validate the flags before the lookup, so a bad combination fails first.
  const sel = selectTarget(opts);
  const document = await resolveDocument(client, idArg);
  const input: Record<string, any> = {};
  if (opts.title !== undefined) input.title = opts.title;
  if (opts.content !== undefined) input.content = opts.content;
  if (sel) Object.assign(input, targetInput(await resolveTarget(client, sel, defaultTeamKey)));

  if (Object.keys(input).length === 0)
    throw usageError(
      `Nothing to update; pass at least one of --title, --content, or a new target (${TARGET_FLAGS}).`,
    );

  return unwrapMutation(
    withRetry(() => client.updateDocument(document.id, input as any)),
    "document",
    "Document update",
  );
}

export async function deleteDocument(client: LinearClient, idArg: string) {
  const document = await resolveDocument(client, idArg);
  await assertMutation(withRetry(() => client.deleteDocument(document.id)), "Document deletion");
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
