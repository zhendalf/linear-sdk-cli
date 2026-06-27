/**
 * Initiative-update service: create an initiative status update, and list an
 * initiative's updates. Mirrors the project-update service. All SDK calls are
 * wrapped in `withRetry`; the initiative is resolved by name or id via the
 * existing `resolveInitiative`.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { collect } from "../lib/pagination.js";
import { usageError } from "../lib/errors.js";
import type { Health } from "../lib/status-update.js";
import { resolveInitiative } from "./initiative.js";
import type { UpdateRow } from "./project.js";

export type { UpdateRow };

/** List an initiative's status updates (by initiative name or id). */
export async function listInitiativeUpdates(
  client: LinearClient,
  idArg: string,
  limit: number,
): Promise<UpdateRow[]> {
  const initiative = await resolveInitiative(client, idArg);
  const conn = await withRetry(() =>
    initiative.initiativeUpdates({ first: Math.min(limit === Infinity ? 100 : limit, 100) }),
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

export interface CreateInitiativeUpdateOptions {
  body: string;
  health?: Health;
}

/** Create a status update on an initiative (resolved by name or id). Returns a normalized row. */
export async function createInitiativeUpdate(
  client: LinearClient,
  idArg: string,
  opts: CreateInitiativeUpdateOptions,
): Promise<UpdateRow & { url: string }> {
  const initiative = await resolveInitiative(client, idArg);
  const input: Record<string, any> = { initiativeId: initiative.id, body: opts.body };
  if (opts.health) input.health = opts.health;

  const payload = await withRetry(() => client.createInitiativeUpdate(input as any));
  const update = await payload.initiativeUpdate;
  if (!update) throw usageError("Initiative update creation returned no update.");
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
