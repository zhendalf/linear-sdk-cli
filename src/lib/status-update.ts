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

/** The health values Linear accepts for a status update (Project/InitiativeUpdateHealthType). */
export const HEALTH_CHOICES = ["onTrack", "atRisk", "offTrack"] as const;
export type Health = (typeof HEALTH_CHOICES)[number];

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
