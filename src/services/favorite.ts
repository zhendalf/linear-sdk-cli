/**
 * Favorite service: all SDK access for the viewer's favorites lives here so
 * commands stay thin.
 *
 * A favorite references one of many entity kinds (issue, project, document,
 * cycle, …); `type` says which, and the matching getter resolves the referenced
 * model. The list is relation-light and personal (small), so awaiting the one
 * relevant getter per row with Promise.all is acceptable (no tailored GraphQL).
 * `add` resolves an issue/project to its id and builds a single-target
 * FavoriteCreateInput; `remove` deletes by id.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { shape } from "../lib/shape.js";
import { collect, inheritPaginationMetadata, pageSize } from "../lib/pagination.js";
import { usageError } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import { resolveIssue, resolveProjectId, isUuid } from "../lib/resolve.js";

export interface FavoriteRow {
  id: string;
  type: string;
  name: string;
  url: string | null;
}

/** The row's shape as `linear commands` advertises it (TES-610); checked against the interface. */
export const FAVORITE_ROW_SHAPE = shape<FavoriteRow>({
  id: "string",
  type: "string",
  name: "string",
  url: "string|null",
});

/**
 * Resolve the human-facing title/name of the entity a favorite points at.
 * Picks the getter matching `type` (falling back to a scan of the common ones),
 * then reads a name-like field off the resolved model.
 */
export async function favoriteName(fav: any): Promise<string> {
  // Folders carry their own name and reference no entity.
  if (fav.type === "folder") return fav.folderName ?? "(folder)";
  if (fav.type === "predefinedView") return fav.predefinedViewType ?? "(view)";

  // The getter named after `type` holds the referenced entity for the common
  // kinds; otherwise probe the handful we care about in a stable order.
  const candidates =
    fav.type && typeof fav[fav.type] !== "undefined"
      ? [fav.type]
      : ["issue", "project", "document", "cycle", "label", "customView", "user", "team"];
  for (const key of candidates) {
    const getter = fav[key];
    if (getter === undefined || getter === null) continue;
    const entity = await getter;
    if (!entity) continue;
    return entityLabel(entity);
  }
  return fav.folderName ?? "—";
}

/** A display label for a referenced entity, tolerant of its concrete kind. */
export function entityLabel(entity: any): string {
  if (entity.identifier && entity.title) return `${entity.identifier} ${entity.title}`;
  return entity.title ?? entity.name ?? entity.displayName ?? entity.key ?? entity.id ?? "—";
}

/** The viewer's favorites: type, referenced entity name, and id. */
export async function listFavorites(client: LinearClient, limit: number): Promise<FavoriteRow[]> {
  const conn = await withRetry(() => client.favorites({ first: pageSize(limit) }));
  const nodes = await collect(conn as any, limit);
  return inheritPaginationMetadata(
    await Promise.all(
      nodes.map(async (f: any) => ({
        id: f.id,
        type: f.type,
        name: await favoriteName(f),
        url: f.url ?? null,
      })),
    ),
    nodes,
  );
}

export interface AddOptions {
  issue?: string;
  project?: string;
  document?: string;
}

/**
 * Build a FavoriteCreateInput from exactly one target. Throws a usage error if
 * zero or more than one target is given. Resolves the id for the chosen target
 * (issue/project via the shared resolvers; document is taken as a UUID).
 * Exported for unit testing.
 */
export async function buildFavoriteInput(
  client: LinearClient,
  opts: AddOptions,
): Promise<Record<string, string>> {
  const targets = [
    ["issue", opts.issue],
    ["project", opts.project],
    ["document", opts.document],
  ].filter(([, v]) => v !== undefined && v !== "") as Array<[string, string]>;

  if (targets.length === 0) {
    throw usageError("Specify exactly one target: --issue, --project, or --document.");
  }
  if (targets.length > 1) {
    throw usageError(
      `Specify exactly one target, not ${targets.length} (${targets.map(([k]) => `--${k}`).join(", ")}).`,
    );
  }

  const [kind, value] = targets[0]!;
  switch (kind) {
    case "issue":
      return { issueId: (await resolveIssue(client, value)).id };
    case "project":
      return { projectId: await resolveProjectId(client, value) };
    case "document":
      if (!isUuid(value)) throw usageError("A document must be referenced by its UUID.");
      return { documentId: value };
    default:
      throw usageError("Unknown favorite target.");
  }
}

/** Create a favorite for the single resolved target; unwraps the payload. */
export async function addFavorite(client: LinearClient, opts: AddOptions) {
  const input = await buildFavoriteInput(client, opts);
  return unwrapMutation(
    withRetry(() => client.createFavorite(input as any)),
    "favorite",
    "Favorite creation",
  );
}

/** Delete a favorite by id. */
export async function removeFavorite(client: LinearClient, id: string) {
  await assertMutation(
    withRetry(() => client.deleteFavorite(id)),
    "Favorite removal",
  );
  return { id };
}
