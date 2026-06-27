/**
 * Shared scaffolding for the `project-update` / `initiative-update` groups.
 *
 * Both groups take the same content inputs (`--body` / `--body-file` / `--editor`)
 * and the same `--health` enum, so the option wiring and body resolution live here
 * once instead of being duplicated per group.
 */

import { Command, Option } from "commander";
import { resolveBody } from "./body.js";
import { usageError } from "./errors.js";
import type { Context } from "../context.js";
import type { Column } from "../output/table.js";

/** The health values Linear accepts for a status update (Project/InitiativeUpdateHealthType). */
export const HEALTH_CHOICES = ["onTrack", "atRisk", "offTrack"] as const;
export type Health = (typeof HEALTH_CHOICES)[number];

/** A normalized status-update row, shared by project- and initiative-update. */
export interface UpdateRow {
  id: string;
  createdAt: string;
  user: string;
  body: string;
  health: string | null;
}

/** The table columns for listing status updates — identical for both groups. */
export const UPDATE_COLUMNS: Column<UpdateRow>[] = [
  { key: "createdAt", header: "Date", value: (u) => u.createdAt.slice(0, 10) },
  { key: "user", header: "Author", value: (u) => u.user, max: 18 },
  { key: "health", header: "Health", value: (u) => u.health ?? "—", max: 10 },
  { key: "body", header: "Update", value: (u) => u.body.replace(/\n/g, " "), max: 60 },
];

/**
 * Unwrap and normalize a `create{Project,Initiative}Update` payload into the shared
 * row shape (plus the update's `url`). The `payloadKey` is the payload field that
 * holds the created update (`projectUpdate` / `initiativeUpdate`).
 */
export async function normalizeUpdatePayload(
  payload: any,
  payloadKey: string,
): Promise<UpdateRow & { url: string }> {
  const update = await payload[payloadKey];
  if (!update) throw usageError("Status update creation returned no update.");
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

/** Add the shared `--body` / `--body-file` / `--editor` / `--health` flags to a `create` command. */
export function addUpdateFlags(cmd: Command): Command {
  return cmd
    .option("--body <text>", "update body (markdown)")
    .option("--body-file <path>", "read body from a file ('-' = stdin)")
    .option("--editor", "compose the body in $EDITOR")
    .addOption(new Option("--health <state>", "status health").choices([...HEALTH_CHOICES]));
}

/**
 * Resolve the body for a status update from the shared flags. A status update must
 * have content, so an empty/absent body is a usage error.
 */
export function resolveUpdateBody(ctx: Context, opts: Record<string, any>): string {
  const body = resolveBody({
    arg: opts.body,
    file: opts.bodyFile,
    interactive: !!opts.editor && ctx.isTTY,
  });
  if (body === undefined || body.trim() === "") {
    throw usageError("An update needs a body. Pass --body, --body-file, or --editor.");
  }
  return body;
}
