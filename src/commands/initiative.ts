/**
 * `linear initiative` (alias `init`) — work with workspace initiatives.
 *
 * Initiatives are workspace-scoped (no team). `view`/`update`/`archive`/`delete`
 * take an initiative id (UUID) or name; `create` needs a name and optionally a
 * description, target date, owner, and status.
 */

import { Command, Option } from "commander";
import { action } from "../lib/action.js";
import { resolveBody } from "../lib/body.js";
import { confirmDestructive, promptInput } from "../lib/prompt.js";
import { parseList, parseIntOption, addAliasOption, readAlias } from "../lib/options.js";
import type { Context } from "../context.js";
import * as svc from "../services/initiative.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.InitiativeRow>[] = [
  { key: "name", header: "Name", value: (r) => r.name, max: 40 },
  { key: "status", header: "Status", value: (r) => r.status ?? "—", max: 12 },
  { key: "priority", header: "Pri", value: (r) => (r.priority ? svc.priorityLabel(r.priority) : "—") },
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
    .description("List workspace initiatives (every status unless --status narrows)")
    // No `-s`/`-o` shorts: `-s` is `--state` and `-o` is `--output` elsewhere
    // in the tree, and a short flag means one thing everywhere here.
    .option("--status <name>", "filter by status (Planned, Active, Completed, Canceled, Proposed)")
    .option("--owner <who>", "filter by owner (me|email|name|id)")
    .option("--archived", "include archived initiatives")
    // The reference CLI lists Active only and needs `--all-statuses` to widen;
    // this list is every status already, so the flag is accepted as the no-op
    // it is here rather than failing a transplanted script.
    .addOption(new Option("--all-statuses", "no-op: the list is all statuses").hideHelp())
    .action(
      action(async (ctx: Context, opts) => {
        const rows = await svc.listInitiatives(ctx.client, ctx.limit, {
          status: opts.status,
          owner: opts.owner,
          archived: !!opts.archived,
        });
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
          ["Archived", detail.archivedAt ? `YES (${detail.archivedAt})` : null],
          ["Status", detail.status],
          ["Priority", detail.priority ? detail.priorityLabel : null],
          ["Labels", detail.labels.length ? detail.labels.join(", ") : null],
          ["Health", detail.health],
          ["Owner", detail.owner],
          ["Creator", detail.creator],
          ["Target", detail.targetDate],
          ["Icon", detail.icon],
          ["Color", detail.color],
          [
            "Projects",
            detail.projects.length
              ? detail.projects
                  .map((p) => `${p.name}${p.status ? ` (${p.status.name})` : ""}`)
                  .join(", ")
              : null,
          ],
          ["URL", detail.url],
          ["Updated", detail.updatedAt],
          ["Description", detail.description ? `\n${detail.description}` : null],
        ]);
      }),
    );

  // create ------------------------------------------------------------------
  const create = initiative
    .command("create")
    .alias("new")
    .description("Create a new initiative")
    .option("--name <name>", "initiative name")
    .option("-d, --description <text>", "initiative description")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--target <date>", "estimated completion date (YYYY-MM-DD)")
    .option("--owner <who>", "initiative owner (me|email|name|id)")
    .option("--status <name>", "status (Planned, Active, Completed, Canceled, Proposed)")
    .option("-P, --priority <0-4>", "priority (0 none, 1 urgent … 4 low)", parseIntOption)
    .option("-l, --label <name>", "initiative label (repeatable / comma-separated)", parseList)
    .option("--icon <name>", "Linear icon name, capitalized (e.g. Rocket)")
    .option("--color <hex>", "initiative color (e.g. #5E6AD2)")
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
          targetDate: readAlias(opts, "--target", "--target-date"),
          owner: opts.owner,
          status: opts.status,
          priority: opts.priority,
          label: opts.label,
          icon: opts.icon,
          color: opts.color,
        });
        ctx.output.emit({ id: created.id, name: created.name, url: created.url }, () =>
          ctx.output.success(`Created ${created.name}: ${created.url}`),
        );
      }),
    );
  addAliasOption(create, "--target-date <date>", "--target");

  // update ------------------------------------------------------------------
  const update = initiative
    .command("update <id>")
    .alias("edit")
    .description("Update an initiative")
    .option("--name <name>", "new name")
    .option("-d, --description <text>", "new description")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--target <date>", "estimated completion date (YYYY-MM-DD)")
    .option("--owner <who>", "initiative owner (me|email|name|id)")
    .option("--status <name>", "status (Planned, Active, Completed, Canceled, Proposed)")
    .option("-P, --priority <0-4>", "priority (0 none, 1 urgent … 4 low)", parseIntOption)
    .option("-l, --label <name>", "replace the labels (repeatable / comma-separated)", parseList)
    .option("--icon <name>", "Linear icon name, capitalized (e.g. Rocket)")
    .option("--color <hex>", "initiative color (e.g. #5E6AD2)")
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
          targetDate: readAlias(opts, "--target", "--target-date"),
          owner: opts.owner,
          status: opts.status,
          priority: opts.priority,
          label: opts.label,
          icon: opts.icon,
          color: opts.color,
        });
        ctx.output.emit({ id: updated.id, name: updated.name, url: updated.url }, () =>
          ctx.output.success(`Updated ${updated.name}`),
        );
      }),
    );
  addAliasOption(update, "--target-date <date>", "--target");

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

  // unarchive ---------------------------------------------------------------
  initiative
    .command("unarchive <id>")
    .description("Unarchive an initiative")
    .action(
      action(async (ctx: Context, _opts, idArg: string) => {
        const restored = await svc.unarchiveInitiative(ctx.client, idArg);
        ctx.output.emit({ id: restored.id, name: restored.name, archived: false }, () =>
          ctx.output.success(`Unarchived ${restored.name}`),
        );
      }),
    );

  // add-project / remove-project --------------------------------------------
  initiative
    .command("add-project <initiative> <project>")
    .description("Link a project to an initiative")
    .option("--sort-order <n>", "position among the initiative's projects", parseIntOption)
    .addHelpText(
      "after",
      ["", "Examples:", "  linear initiative add-project 'Q3 Bets' 'API v2'"].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts, initiativeArg: string, projectArg: string) => {
        const link = await svc.addProject(ctx.client, initiativeArg, projectArg, {
          sortOrder: opts.sortOrder,
        });
        ctx.output.emit(link, () =>
          ctx.output.success(`Linked ${link.project.name} to ${link.initiative.name}`),
        );
      }),
    );

  initiative
    .command("remove-project <initiative> <project>")
    .description("Unlink a project from an initiative")
    .action(
      action(async (ctx: Context, _opts, initiativeArg: string, projectArg: string) => {
        const link = await svc.findProjectLink(ctx.client, initiativeArg, projectArg);
        if (
          !(await confirmDestructive(
            ctx,
            `Remove ${link.project.name} from initiative ${link.initiative.name}?`,
          ))
        )
          return;
        await svc.removeProjectLink(ctx.client, link);
        ctx.output.emit({ ...link, removed: true }, () =>
          ctx.output.success(`Removed ${link.project.name} from ${link.initiative.name}`),
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
