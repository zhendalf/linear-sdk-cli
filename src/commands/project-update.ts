/**
 * `linear project-update` (alias `pu`) — post and list project status updates.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { addUpdateFlags, resolveUpdateBody, UPDATE_COLUMNS } from "../lib/status-update.js";
import type { Context } from "../context.js";
import * as svc from "../services/project-update.js";

export function registerProjectUpdate(program: Command): void {
  const group = program
    .command("project-update")
    .alias("pu")
    .description("Post and list project status updates");

  // create ------------------------------------------------------------------
  addUpdateFlags(
    group
      .command("create")
      .argument("<project>", "project identifier (e.g. P-TES-123), name, or UUID")
      .alias("new")
      .description("Post a status update on a project (by identifier, name, or UUID)"),
  ).action(
    action(async (ctx: Context, opts, projectArg: string) => {
      const body = resolveUpdateBody(ctx, opts);
      const created = await svc.createProjectUpdate(ctx.client, projectArg, {
        body,
        health: opts.health,
      });
      ctx.output.emit(created, () =>
        ctx.output.success(`Posted project update${opts.health ? ` (${opts.health})` : ""}`),
      );
    }),
  );

  // list --------------------------------------------------------------------
  group
    .command("list")
    .argument("<project>", "project identifier (e.g. P-TES-123), name, or UUID")
    .alias("ls")
    .description("List a project's status updates (project identifier, name, or UUID)")
    .action(
      action(async (ctx: Context, _opts, projectArg: string) => {
        const rows = await svc.listProjectUpdates(ctx.client, projectArg, ctx.limit);
        ctx.output.list(rows, UPDATE_COLUMNS, rows);
      }),
    );
}
