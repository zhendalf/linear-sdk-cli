/**
 * Project-update service: create a project status update, and list a project's
 * updates. The list reuses the existing `listUpdates` in `services/project.ts`
 * (re-exported here as `listProjectUpdates` so the new command group owns a
 * coherent surface). All SDK calls are wrapped in `withRetry`.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { usageError } from "../lib/errors.js";
import { resolveProjectId } from "../lib/resolve.js";
import type { Health } from "../lib/status-update.js";
import { listUpdates, type UpdateRow } from "./project.js";

export type { UpdateRow };

/** List a project's status updates (by project name or id). */
export const listProjectUpdates = listUpdates;

export interface CreateProjectUpdateOptions {
  body: string;
  health?: Health;
}

/** Create a status update on a project (resolved by name or id). Returns a normalized row. */
export async function createProjectUpdate(
  client: LinearClient,
  idArg: string,
  opts: CreateProjectUpdateOptions,
): Promise<UpdateRow & { url: string }> {
  const projectId = await resolveProjectId(client, idArg);
  const input: Record<string, any> = { projectId, body: opts.body };
  if (opts.health) input.health = opts.health;

  const payload = await withRetry(() => client.createProjectUpdate(input as any));
  const update = await payload.projectUpdate;
  if (!update) throw usageError("Project update creation returned no update.");
  const user = await update.user;
  return {
    id: update.id,
    createdAt: update.createdAt?.toISOString?.() ?? String(update.createdAt),
    user: user?.displayName ?? "unknown",
    body: update.body ?? "",
    health: update.health ?? null,
    url: update.url,
  };
}
