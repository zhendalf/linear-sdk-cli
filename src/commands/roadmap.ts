/**
 * `linear roadmap` (alias `rm`) — work with workspace roadmaps.
 *
 * Note: `rm` is the GROUP alias here; no subcommand aliases `rm` (that would
 * collide with the group's own alias and read confusingly as a delete).
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { resolveBody } from "../lib/body.js";
import { confirmDestructive, promptInput } from "../lib/prompt.js";
import type { Context } from "../context.js";
import * as svc from "../services/roadmap.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.RoadmapRow>[] = [
  { key: "name", header: "Name", value: (r) => r.name, max: 36 },
  { key: "description", header: "Description", value: (r) => r.description ?? "—", max: 60 },
  { key: "id", header: "ID", value: (r) => r.id },
];

export function registerRoadmap(program: Command): void {
  const roadmap = program.command("roadmap").alias("rm").description("Work with roadmaps");

  // list --------------------------------------------------------------------
  roadmap
    .command("list")
    .alias("ls")
    .description("List roadmaps")
    .action(
      action(async (ctx: Context, _opts) => {
        const rows = await svc.listRoadmaps(ctx.client, ctx.limit);
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  // view --------------------------------------------------------------------
  roadmap
    .command("view <id>", { isDefault: true })
    .alias("show")
    .description("Show a roadmap (by name or id)")
    .action(
      action(async (ctx: Context, _opts, idArg: string) => {
        const detail = await svc.getRoadmapDetail(ctx.client, idArg);
        ctx.output.detail(detail, [
          ["Roadmap", detail.name],
          ["Owner", detail.owner],
          ["Creator", detail.creator],
          ["Color", detail.color],
          ["Projects", detail.projects.length ? detail.projects.join(", ") : null],
          ["URL", detail.url],
          ["Updated", detail.updatedAt],
          ["ID", detail.id],
          ["Description", detail.description ? `\n${detail.description}` : null],
        ]);
      }),
    );

  // create ------------------------------------------------------------------
  roadmap
    .command("create")
    .alias("new")
    .description("Create a new roadmap")
    .option("--name <name>", "roadmap name")
    .option("-d, --description <text>", "roadmap description")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--owner <who>", "roadmap owner (me|email|name|id)")
    .option("--color <hex>", "roadmap color (e.g. #5e6ad2)")
    .action(
      action(async (ctx: Context, opts) => {
        let name: string | undefined = opts.name;
        if (!name) name = await promptInput(ctx, "Name:", { required: true });
        const description = resolveBody({
          arg: opts.description,
          file: opts.descriptionFile,
          interactive: false,
        });
        const created = await svc.createRoadmap(ctx.client, {
          name,
          description,
          owner: opts.owner,
          color: opts.color,
        });
        ctx.output.emit({ id: created.id, name: created.name, url: created.url }, () =>
          ctx.output.success(`Created ${created.name}: ${created.url}`),
        );
      }),
    );

  // update ------------------------------------------------------------------
  roadmap
    .command("update <id>")
    .alias("edit")
    .description("Update a roadmap")
    .option("--name <name>", "new name")
    .option("-d, --description <text>", "new description")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--owner <who>", "roadmap owner (me|email|name|id)")
    .option("--color <hex>", "roadmap color (e.g. #5e6ad2)")
    .action(
      action(async (ctx: Context, opts, idArg: string) => {
        const description = resolveBody({
          arg: opts.description,
          file: opts.descriptionFile,
          interactive: false,
        });
        const updated = await svc.updateRoadmap(ctx.client, idArg, {
          name: opts.name,
          description,
          owner: opts.owner,
          color: opts.color,
        });
        ctx.output.emit({ id: updated.id, name: updated.name, url: updated.url }, () =>
          ctx.output.success(`Updated ${updated.name}`),
        );
      }),
    );

  // delete ------------------------------------------------------------------
  // No `rm` alias here: `rm` is the group alias and a `roadmap rm rm` would be confusing.
  roadmap
    .command("delete <id>")
    .alias("del")
    .description("Delete a roadmap")
    .action(
      action(async (ctx: Context, _opts, idArg: string) => {
        const rm = await svc.getRoadmapDetail(ctx.client, idArg);
        if (!(await confirmDestructive(ctx, `Delete roadmap ${rm.name}?`))) return;
        const deleted = await svc.deleteRoadmap(ctx.client, rm.id);
        ctx.output.emit({ id: deleted.id, name: deleted.name, deleted: true }, () =>
          ctx.output.success(`Deleted ${deleted.name}`),
        );
      }),
    );
}
