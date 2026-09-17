/** `linear project-status` — manage workspace project-status definitions. */

import { Command } from "commander";
import type { Context } from "../context.js";
import { action } from "../lib/action.js";
import { resolveBody } from "../lib/body.js";
import { usageError } from "../lib/errors.js";
import { confirmDestructive, promptInput } from "../lib/prompt.js";
import type { Column } from "../output/table.js";
import * as svc from "../services/project-status.js";

const ROW_COLUMNS: Column<svc.ProjectStatusRow>[] = [
  { key: "name", header: "Name", value: (r) => r.name, max: 28 },
  { key: "type", header: "Type", value: (r) => r.type },
  { key: "position", header: "Pos", value: (r) => r.position },
  { key: "color", header: "Color", value: (r) => r.color },
  { key: "indefinite", header: "Indefinite", value: (r) => (r.indefinite ? "yes" : "no") },
  { key: "archived", header: "Archived", value: (r) => (r.archivedAt ? "yes" : "no") },
];

export function registerProjectStatus(program: Command): void {
  const status = program
    .command("project-status")
    .alias("project-statuses")
    .description("Manage workspace project-status definitions");

  status
    .command("list")
    .alias("ls")
    .description("List workspace project statuses")
    .option("--include-archived", "include archived project statuses")
    .action(
      action(async (ctx: Context, opts) => {
        const rows = await svc.listProjectStatuses(ctx.client, ctx.limit, !!opts.includeArchived);
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  status
    .command("view <name-or-id>")
    .description("Show a project status by exact name or id")
    .action(
      action(async (ctx: Context, _opts, input: string) => {
        const detail = await svc.getProjectStatusDetail(ctx.client, input);
        ctx.output.detail(detail, [
          ["Project status", detail.name],
          ["ID", detail.id],
          ["Type", detail.type],
          ["Position", detail.position],
          ["Color", detail.color],
          ["Indefinite", detail.indefinite],
          ["Archived", detail.archivedAt],
          ["Description", detail.description ? `\n${detail.description}` : null],
          ["Created", detail.createdAt],
          ["Updated", detail.updatedAt],
        ]);
      }),
    );

  status
    .command("create")
    .alias("new")
    .description("Create a workspace project status (explicit because duplicate names are valid)")
    .option("--name <name>", "status name")
    .option("-d, --description <text>", "status description")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--color <hex>", "six-digit hex color (e.g. #5E6AD2)")
    .option("--position <number>", "position within the status type", parseNumber)
    .option("--type <type>", `status type (${svc.PROJECT_STATUS_TYPES.join("|")})`)
    .option("--indefinite", "allow projects to remain in this status indefinitely")
    .action(
      action(async (ctx: Context, opts) => {
        let name: string | undefined = opts.name;
        if (!name) name = await promptInput(ctx, "Name:", { required: true });
        const created = await svc.createProjectStatus(ctx.client, {
          name,
          description: resolveBody({
            arg: opts.description,
            file: opts.descriptionFile,
            interactive: false,
          }),
          color: opts.color,
          position: opts.position,
          type: opts.type,
          indefinite: opts.indefinite,
        });
        ctx.output.emit(statusReceipt(created), () =>
          ctx.output.success(`Created project status ${created.name}`),
        );
      }),
    );

  status
    .command("update <name-or-id>")
    .alias("edit")
    .description("Update a project status by exact name or id")
    .option("--name <name>", "new status name")
    .option("-d, --description <text>", "new status description")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--color <hex>", "six-digit hex color (e.g. #5E6AD2)")
    .option("--position <number>", "position within the status type", parseNumber)
    .option("--type <type>", `status type (${svc.PROJECT_STATUS_TYPES.join("|")})`)
    .option("--indefinite", "allow projects to remain in this status indefinitely")
    .option("--no-indefinite", "do not allow projects to remain indefinitely")
    .action(
      action(async (ctx: Context, opts, input: string) => {
        const updated = await svc.updateProjectStatus(ctx.client, input, {
          name: opts.name,
          description: resolveBody({
            arg: opts.description,
            file: opts.descriptionFile,
            interactive: false,
          }),
          color: opts.color,
          position: opts.position,
          type: opts.type,
          indefinite: opts.indefinite,
        });
        ctx.output.emit(statusReceipt(updated), () =>
          ctx.output.success(`Updated project status ${updated.name}`),
        );
      }),
    );

  status
    .command("archive <name-or-id>")
    .description(
      "Archive a project status (requires no active projects and another status of its type)",
    )
    .action(
      action(async (ctx: Context, _opts, input: string) => {
        const detail = await svc.getProjectStatusDetail(ctx.client, input);
        if (!(await confirmDestructive(ctx, `Archive project status ${detail.name}?`))) return;
        const archived = await svc.archiveProjectStatus(ctx.client, detail.id);
        ctx.output.emit({ id: archived.id, name: archived.name, archived: true }, () =>
          ctx.output.success(`Archived project status ${archived.name}`),
        );
      }),
    );

  status
    .command("unarchive <name-or-id>")
    .description("Unarchive a project status by exact name or id")
    .action(
      action(async (ctx: Context, _opts, input: string) => {
        const restored = await svc.unarchiveProjectStatus(ctx.client, input);
        ctx.output.emit({ id: restored.id, name: restored.name, archived: false }, () =>
          ctx.output.success(`Unarchived project status ${restored.name}`),
        );
      }),
    );
}

function statusReceipt(status: any) {
  return {
    id: status.id,
    name: status.name,
    type: status.type,
  };
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw usageError(`Invalid number '${value}'.`);
  return parsed;
}
