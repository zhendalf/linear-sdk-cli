/**
 * `linear milestone` (alias `m`) — project milestone management.
 *
 * Milestones live inside a project: `list`/`create` take a project reference
 * (name or id), while `view`/`update`/`delete` take a milestone id.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { resolveBody } from "../lib/body.js";
import { confirmDestructive, promptInput } from "../lib/prompt.js";
import type { Context } from "../context.js";
import * as svc from "../services/milestone.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.MilestoneRow>[] = [
  { key: "name", header: "Name", value: (r) => r.name, max: 40 },
  { key: "target", header: "Target", value: (r) => r.targetDate ?? "—" },
  { key: "progress", header: "Progress", value: (r) => `${Math.round(r.progress * 100)}%` },
  { key: "status", header: "Status", value: (r) => r.status, max: 14 },
  { key: "id", header: "ID", value: (r) => r.id },
];

export function registerMilestone(program: Command): void {
  const milestone = program
    .command("milestone")
    .alias("m")
    .description("Work with project milestones");

  // list --------------------------------------------------------------------
  milestone
    .command("list <project>")
    .alias("ls")
    .description("List milestones in a project")
    .action(
      action(async (ctx: Context, _opts, project: string) => {
        const rows = await svc.listMilestones(ctx.client, project, ctx.limit);
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  // view --------------------------------------------------------------------
  milestone
    .command("view <id>")
    .description("Show a milestone and the issues in it")
    .action(
      action(async (ctx: Context, _opts, id: string) => {
        const detail = await svc.getMilestoneDetail(ctx.client, id, ctx.limit);
        const issueLines = detail.issues.map(
          (i) => `  ${i.identifier}  ${i.state ? `[${i.state}] ` : ""}${i.title}`,
        );
        if (detail.issuesTruncated) issueLines.push("  … more (use --all)");
        ctx.output.detail(detail, [
          ["Milestone", detail.name],
          ["Project", detail.project],
          ["Target", detail.targetDate],
          ["Progress", `${Math.round(detail.progress * 100)}%`],
          ["Status", detail.status],
          ["Updated", detail.updatedAt],
          ["ID", detail.id],
          ["Issues", issueLines.length ? `\n${issueLines.join("\n")}` : null],
          ["Description", detail.description ? `\n${detail.description}` : null],
        ]);
      }),
    );

  // create ------------------------------------------------------------------
  milestone
    .command("create <project>")
    .alias("new")
    .description("Create a milestone in a project")
    .option("--name <name>", "milestone name")
    .option("-d, --description <text>", "milestone description (body)")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--target <date>", "target date (YYYY-MM-DD)")
    .action(
      action(async (ctx: Context, opts, project: string) => {
        let name: string | undefined = opts.name;
        if (!name) name = await promptInput(ctx, "Name:", { required: true });
        const description = resolveBody({
          arg: opts.description,
          file: opts.descriptionFile,
          interactive: false,
        });
        const created = await svc.createMilestone(ctx.client, project, {
          name,
          description,
          targetDate: opts.target,
        });
        ctx.output.emit({ id: created.id, name: created.name }, () =>
          ctx.output.success(`Created milestone ${created.name}`),
        );
      }),
    );

  // update ------------------------------------------------------------------
  milestone
    .command("update <id>")
    .alias("edit")
    .description("Update a milestone")
    .option("--name <name>", "new name")
    .option("-d, --description <text>", "new description")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--target <date>", "target date (YYYY-MM-DD)")
    .action(
      action(async (ctx: Context, opts, id: string) => {
        const description = resolveBody({
          arg: opts.description,
          file: opts.descriptionFile,
          interactive: false,
        });
        const updated = await svc.updateMilestone(ctx.client, id, {
          name: opts.name,
          description,
          targetDate: opts.target,
        });
        ctx.output.emit({ id: updated.id, name: updated.name }, () =>
          ctx.output.success(`Updated milestone ${updated.name}`),
        );
      }),
    );

  // delete ------------------------------------------------------------------
  milestone
    .command("delete <id>")
    .alias("rm")
    .description("Delete a milestone")
    .action(
      action(async (ctx: Context, _opts, id: string) => {
        if (!(await confirmDestructive(ctx, `Delete milestone ${id}?`))) return;
        const deleted = await svc.deleteMilestone(ctx.client, id);
        ctx.output.emit({ id: deleted.id, name: deleted.name, deleted: true }, () =>
          ctx.output.success(`Deleted milestone ${deleted.name}`),
        );
      }),
    );
}
