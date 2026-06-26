/**
 * `linear favorite` (alias `fav`) — manage the viewer's favorites.
 *
 * `list` shows each favorite's type and the referenced thing's title. `add`
 * takes exactly one of --issue / --project / --document. `remove` deletes a
 * favorite by its id (confirmed when destructive).
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { confirmDestructive } from "../lib/prompt.js";
import type { Context } from "../context.js";
import * as svc from "../services/favorite.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.FavoriteRow>[] = [
  { key: "type", header: "Type", value: (r) => r.type, max: 16 },
  { key: "name", header: "Name", value: (r) => r.name, max: 60 },
  { key: "id", header: "ID", value: (r) => r.id },
];

export function registerFavorite(program: Command): void {
  const favorite = program.command("favorite").alias("fav").description("Manage your favorites");

  // list --------------------------------------------------------------------
  favorite
    .command("list")
    .alias("ls")
    .description("List your favorites")
    .action(
      action(async (ctx: Context) => {
        const rows = await svc.listFavorites(ctx.client, ctx.limit);
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  // add ---------------------------------------------------------------------
  favorite
    .command("add")
    .alias("new")
    .description("Favorite an issue, project, or document (exactly one)")
    .option("--issue <id>", "issue id or identifier (e.g. TES-123)")
    .option("--project <id|name>", "project name or id")
    .option("--document <id>", "document id (UUID)")
    .action(
      action(async (ctx: Context, opts) => {
        const created = await svc.addFavorite(ctx.client, {
          issue: opts.issue,
          project: opts.project,
          document: opts.document,
        });
        ctx.output.emit({ id: created.id, type: created.type }, () =>
          ctx.output.success(`Favorited ${created.type} (${created.id})`),
        );
      }),
    );

  // remove ------------------------------------------------------------------
  favorite
    .command("remove <favoriteId>")
    .alias("rm")
    .description("Remove a favorite by id")
    .action(
      action(async (ctx: Context, _opts, favoriteId: string) => {
        if (!(await confirmDestructive(ctx, `Remove favorite ${favoriteId}?`))) return;
        const removed = await svc.removeFavorite(ctx.client, favoriteId);
        ctx.output.emit({ id: removed.id, removed: true }, () =>
          ctx.output.success(`Removed favorite ${removed.id}`),
        );
      }),
    );
}
