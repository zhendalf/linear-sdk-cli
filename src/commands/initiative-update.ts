/**
 * `linear initiative-update` (alias `iu`) — post and list initiative status updates.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { addUpdateFlags, resolveUpdateBody, UPDATE_COLUMNS } from "../lib/status-update.js";
import type { Context } from "../context.js";
import * as svc from "../services/initiative-update.js";

export function registerInitiativeUpdate(program: Command): void {
  const group = program
    .command("initiative-update")
    .alias("iu")
    .description("Post and list initiative status updates");

  // create ------------------------------------------------------------------
  addUpdateFlags(
    group
      .command("create <initiative>")
      .alias("new")
      .description("Post a status update on an initiative (by name or id)"),
  ).action(
    action(async (ctx: Context, opts, initiativeArg: string) => {
      const body = resolveUpdateBody(ctx, opts);
      const created = await svc.createInitiativeUpdate(ctx.client, initiativeArg, {
        body,
        health: opts.health,
      });
      ctx.output.emit(created, () =>
        ctx.output.success(`Posted initiative update${opts.health ? ` (${opts.health})` : ""}`),
      );
    }),
  );

  // list --------------------------------------------------------------------
  group
    .command("list <initiative>")
    .alias("ls")
    .description("List an initiative's status updates")
    .action(
      action(async (ctx: Context, _opts, initiativeArg: string) => {
        const rows = await svc.listInitiativeUpdates(ctx.client, initiativeArg, ctx.limit);
        ctx.output.list(rows, UPDATE_COLUMNS, rows);
      }),
    );
}
