/** `linear project-label` — manage labels that apply to projects, not issues. */

import { Command } from "commander";
import type { Context } from "../context.js";
import { action } from "../lib/action.js";
import { confirmDestructive, promptInput } from "../lib/prompt.js";
import type { Column } from "../output/table.js";
import * as svc from "../services/project-label.js";

const COLUMNS: Column<svc.ProjectLabelRow>[] = [
  { key: "name", header: "Name", value: (label) => label.name, max: 30 },
  { key: "color", header: "Color", value: (label) => label.color },
  { key: "group", header: "Group", value: (label) => (label.isGroup ? "yes" : "—") },
  { key: "parent", header: "Parent", value: (label) => label.parent?.name ?? "—" },
  { key: "retired", header: "Retired", value: (label) => (label.retiredAt ? "yes" : "—") },
];

const receipt = (label: { id: string; name: string; color: string }) => ({
  id: label.id,
  name: label.name,
  color: label.color,
});

export function registerProjectLabel(program: Command): void {
  const labels = program
    .command("project-label")
    .alias("pl")
    .description("Manage project labels (distinct from issue labels)");

  labels
    .command("list")
    .alias("ls")
    .description("List project labels")
    .option("--include-retired", "include labels retired from new project assignment")
    .action(
      action(async (ctx: Context, opts) => {
        const rows = await svc.listProjectLabels(ctx.client, ctx.limit, !!opts.includeRetired);
        ctx.output.list(rows, COLUMNS, rows);
      }),
    );

  labels
    .command("view <name-or-id>")
    .description("View a project label or label group by exact name or id")
    .action(
      action(async (ctx: Context, _opts, input: string) => {
        const label = await svc.getProjectLabel(ctx.client, input);
        ctx.output.emit(label, () =>
          ctx.output.detail(label.name, [
            ["ID", label.id],
            ["Color", label.color],
            ["Description", label.description],
            ["Group", label.isGroup ? "yes" : "no"],
            ["Parent", label.parent?.name ?? null],
            ["Retired", label.retiredAt],
            [
              "Children",
              label.children.length ? label.children.map((child) => child.name).join(", ") : null,
            ],
          ]),
        );
      }),
    );

  labels
    .command("create")
    .alias("new")
    .description("Create a project label or label group")
    .option("--name <name>", "project label name")
    .option("--color <hex>", "label color (six-digit hex, e.g. #5E6AD2)")
    .option("-d, --description <text>", "label description")
    .option("--group", "create a non-assignable label group")
    .option("--parent <name-or-id>", "put the label in this group")
    .action(
      action(async (ctx: Context, opts) => {
        let name: string | undefined = opts.name;
        if (!name) name = await promptInput(ctx, "Name:", { required: true });
        const label = await svc.createProjectLabel(ctx.client, { ...opts, name });
        ctx.output.emit(receipt(label), () =>
          ctx.output.success(`Created project label ${label.name}`),
        );
      }),
    );

  labels
    .command("update <name-or-id>")
    .alias("edit")
    .description("Update a project label by exact name or id")
    .option("--name <name>", "new name")
    .option("--color <hex>", "new color (six-digit hex, e.g. #5E6AD2)")
    .option("-d, --description <text>", "new description")
    .option("--parent <name-or-id>", "move the label into this group")
    .option("--clear-parent", "remove the label from its group")
    .action(
      action(async (ctx: Context, opts, input: string) => {
        const label = await svc.updateProjectLabel(ctx.client, input, opts);
        ctx.output.emit(receipt(label), () =>
          ctx.output.success(`Updated project label ${label.name}`),
        );
      }),
    );

  labels
    .command("retire <name-or-id>")
    .description("Retire a label so it cannot be assigned to new projects")
    .action(
      action(async (ctx: Context, _opts, input: string) => {
        const current = await svc.getProjectLabel(ctx.client, input);
        if (!(await confirmDestructive(ctx, `Retire project label ${current.name}?`))) return;
        const label = await svc.retireProjectLabel(ctx.client, current.id);
        ctx.output.emit({ id: label.id, name: label.name, retired: true }, () =>
          ctx.output.success(`Retired project label ${label.name}`),
        );
      }),
    );

  labels
    .command("restore <name-or-id>")
    .alias("unretire")
    .description("Restore a retired project label")
    .action(
      action(async (ctx: Context, _opts, input: string) => {
        const label = await svc.restoreProjectLabel(ctx.client, input);
        ctx.output.emit({ id: label.id, name: label.name, restored: true }, () =>
          ctx.output.success(`Restored project label ${label.name}`),
        );
      }),
    );

  labels
    .command("delete <name-or-id>")
    .alias("rm")
    .description("Permanently delete a project label")
    .action(
      action(async (ctx: Context, _opts, input: string) => {
        const current = await svc.getProjectLabel(ctx.client, input);
        if (!(await confirmDestructive(ctx, `Delete project label ${current.name}?`))) return;
        const label = await svc.deleteProjectLabel(ctx.client, current.id);
        ctx.output.emit({ id: label.id, name: label.name, deleted: true }, () =>
          ctx.output.success(`Deleted project label ${label.name}`),
        );
      }),
    );
}
