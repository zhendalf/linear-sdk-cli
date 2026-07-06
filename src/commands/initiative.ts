/**
 * `linear initiative` (alias `init`) — work with workspace initiatives.
 *
 * Initiatives are workspace-scoped (no team). `view`/`update`/`archive`/`delete`
 * take an initiative id (UUID) or name; `create` needs a name and optionally a
 * description, target date, owner, and status.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { resolveBody } from "../lib/body.js";
import { confirmDestructive, promptInput } from "../lib/prompt.js";
import type { Context } from "../context.js";
import * as svc from "../services/initiative.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.InitiativeRow>[] = [
  { key: "name", header: "Name", value: (r) => r.name, max: 40 },
  { key: "status", header: "Status", value: (r) => r.status ?? "—", max: 12 },
  { key: "targetDate", header: "Target", value: (r) => r.targetDate ?? "—" },
  { key: "health", header: "Health", value: (r) => r.health ?? "—", max: 12 },
];

export function registerInitiative(program: Command): void {
  const initiative = program
    .command("initiative")
    .alias("init")
    .description("Work with initiatives");

  // list --------------------------------------------------------------------
  initiative
    .command("list")
    .alias("ls")
    .description("List workspace initiatives")
    .action(
      action(async (ctx: Context) => {
        const rows = await svc.listInitiatives(ctx.client, ctx.limit);
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  // view --------------------------------------------------------------------
  initiative
    .command("view <id>", { isDefault: true })
    .alias("show")
    .description("Show an initiative (by name or id)")
    .action(
      action(async (ctx: Context, _opts, idArg: string) => {
        const detail = await svc.getInitiativeDetail(ctx.client, idArg);
        ctx.output.detail(detail, [
          ["Initiative", detail.name],
          ["Status", detail.status],
          ["Health", detail.health],
          ["Owner", detail.owner],
          ["Creator", detail.creator],
          ["Target", detail.targetDate],
          ["URL", detail.url],
          ["Updated", detail.updatedAt],
          ["Description", detail.description ? `\n${detail.description}` : null],
        ]);
      }),
    );

  // create ------------------------------------------------------------------
  initiative
    .command("create")
    .alias("new")
    .description("Create a new initiative")
    .option("--name <name>", "initiative name")
    .option("-d, --description <text>", "initiative description")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--target <date>", "estimated completion date (YYYY-MM-DD)")
    .option("--owner <who>", "initiative owner (me|email|name|id)")
    .option("--status <name>", "status (Planned, Active, Completed, Canceled, Proposed)")
    .action(
      action(async (ctx: Context, opts) => {
        let name: string | undefined = opts.name;
        if (!name) name = await promptInput(ctx, "Name:", { required: true });
        const description = resolveBody({
          arg: opts.description,
          file: opts.descriptionFile,
          interactive: false,
        });
        const created = await svc.createInitiative(ctx.client, {
          name,
          description,
          targetDate: opts.target,
          owner: opts.owner,
          status: opts.status,
        });
        ctx.output.emit({ id: created.id, name: created.name, url: created.url }, () =>
          ctx.output.success(`Created ${created.name}: ${created.url}`),
        );
      }),
    );

  // update ------------------------------------------------------------------
  initiative
    .command("update <id>")
    .alias("edit")
    .description("Update an initiative")
    .option("--name <name>", "new name")
    .option("-d, --description <text>", "new description")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--target <date>", "estimated completion date (YYYY-MM-DD)")
    .option("--owner <who>", "initiative owner (me|email|name|id)")
    .option("--status <name>", "status (Planned, Active, Completed, Canceled, Proposed)")
    .action(
      action(async (ctx: Context, opts, idArg: string) => {
        const description = resolveBody({
          arg: opts.description,
          file: opts.descriptionFile,
          interactive: false,
        });
        const updated = await svc.updateInitiative(ctx.client, idArg, {
          name: opts.name,
          description,
          targetDate: opts.target,
          owner: opts.owner,
          status: opts.status,
        });
        ctx.output.emit({ id: updated.id, name: updated.name, url: updated.url }, () =>
          ctx.output.success(`Updated ${updated.name}`),
        );
      }),
    );

  // archive -----------------------------------------------------------------
  initiative
    .command("archive <id>")
    .description("Archive an initiative")
    .action(
      action(async (ctx: Context, _opts, idArg: string) => {
        const init = await svc.getInitiativeDetail(ctx.client, idArg);
        if (!(await confirmDestructive(ctx, `Archive initiative ${init.name}?`))) return;
        const archived = await svc.archiveInitiative(ctx.client, init.id);
        ctx.output.emit({ id: archived.id, name: archived.name, archived: true }, () =>
          ctx.output.success(`Archived ${archived.name}`),
        );
      }),
    );

  // delete ------------------------------------------------------------------
  initiative
    .command("delete <id>")
    .alias("rm")
    .description("Delete (trash) an initiative")
    .action(
      action(async (ctx: Context, _opts, idArg: string) => {
        const init = await svc.getInitiativeDetail(ctx.client, idArg);
        if (!(await confirmDestructive(ctx, `Delete initiative ${init.name}?`))) return;
        const deleted = await svc.deleteInitiative(ctx.client, init.id);
        ctx.output.emit({ id: deleted.id, name: deleted.name, deleted: true }, () =>
          ctx.output.success(`Deleted ${deleted.name}`),
        );
      }),
    );
}
