/**
 * `linear label` (alias `lb`) — work with issue labels.
 *
 * Labels are either workspace-level (no team) or scoped to a single team. The
 * `list` command optionally narrows to a team (defaulting to the configured
 * team); create/update/delete take a label name or id.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { confirmDestructive, promptInput } from "../lib/prompt.js";
import type { Context } from "../context.js";
import * as svc from "../services/label.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.LabelRow>[] = [
  { key: "name", header: "Name", value: (r) => r.name, max: 30 },
  { key: "color", header: "Color", value: (r) => r.color },
  { key: "team", header: "Team", value: (r) => r.team?.key ?? "—" },
  { key: "isGroup", header: "Group", value: (r) => (r.isGroup ? "yes" : "no") },
];

export function registerLabel(program: Command): void {
  const label = program.command("label").alias("lb").description("Work with issue labels");

  // list --------------------------------------------------------------------
  label
    .command("list [team]")
    .alias("ls")
    .description("List labels (optionally scoped to a team)")
    .action(
      action(async (ctx: Context, _opts, teamArg?: string) => {
        const rows = await svc.listLabels(ctx.client, teamArg, ctx.limit, ctx.defaultTeam);
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  // create ------------------------------------------------------------------
  label
    .command("create")
    .alias("new")
    .description("Create a label (scoped to --team if set, else workspace-level)")
    .option("--name <name>", "label name")
    .option("--color <hex>", "label color (e.g. #EB5757)")
    .option("-d, --description <text>", "label description")
    .option("--workspace", "force a workspace-level label even when a default team is set")
    .option("--parent <name>", "parent label (creates a sub-label)")
    .action(
      action(async (ctx: Context, opts) => {
        let name: string | undefined = opts.name;
        if (!name) name = await promptInput(ctx, "Name:", { required: true });
        const created = await svc.createLabel(
          ctx.client,
          {
            name,
            color: opts.color,
            description: opts.description,
            // Scope to the global --team (ctx.defaultTeam) unless --workspace.
            team: opts.workspace ? undefined : ctx.defaultTeam,
            parent: opts.parent,
          },
          ctx.defaultTeam,
        );
        ctx.output.emit({ id: created.id, name: created.name, color: created.color }, () =>
          ctx.output.success(`Created label ${created.name}`),
        );
      }),
    );

  // update ------------------------------------------------------------------
  label
    .command("update <id>")
    .alias("edit")
    .description("Update a label (by name or id)")
    .option("--name <name>", "new label name")
    .option("--color <hex>", "new label color (e.g. #EB5757)")
    .option("-d, --description <text>", "new label description")
    .action(
      action(async (ctx: Context, opts, idArg: string) => {
        const updated = await svc.updateLabel(ctx.client, idArg, {
          name: opts.name,
          color: opts.color,
          description: opts.description,
        });
        ctx.output.emit({ id: updated.id, name: updated.name, color: updated.color }, () =>
          ctx.output.success(`Updated label ${updated.name}`),
        );
      }),
    );

  // delete ------------------------------------------------------------------
  label
    .command("delete <id>")
    .alias("rm")
    .description("Delete a label (by name or id)")
    .action(
      action(async (ctx: Context, _opts, idArg: string) => {
        if (!(await confirmDestructive(ctx, `Delete label ${idArg}?`))) return;
        const deleted = await svc.deleteLabel(ctx.client, idArg);
        ctx.output.emit({ id: deleted.id, name: deleted.name, deleted: true }, () =>
          ctx.output.success(`Deleted label ${deleted.name}`),
        );
      }),
    );
}
