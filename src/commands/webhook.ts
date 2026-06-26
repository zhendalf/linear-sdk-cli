/**
 * `linear webhook` (alias `wh`) — manage workspace webhooks.
 *
 * Webhooks are workspace-scoped; `create` may scope one to a single team via the
 * global -t/--team (read from ctx.defaultTeam — there is no local --team option,
 * which would collide). `--resource` is repeatable (collectArray) and required.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { collectArray } from "../lib/options.js";
import { confirmDestructive } from "../lib/prompt.js";
import { usageError } from "../lib/errors.js";
import type { Context } from "../context.js";
import * as svc from "../services/webhook.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.WebhookRow>[] = [
  { key: "id", header: "ID", value: (r) => r.id },
  { key: "url", header: "URL", value: (r) => r.url ?? "—", max: 40 },
  { key: "enabled", header: "Enabled", value: (r) => (r.enabled ? "yes" : "no") },
  {
    key: "resourceTypes",
    header: "Resources",
    value: (r) => (r.resourceTypes.length ? r.resourceTypes.join(", ") : "—"),
    max: 40,
  },
];

export function registerWebhook(program: Command): void {
  const webhook = program.command("webhook").alias("wh").description("Manage workspace webhooks");

  // list --------------------------------------------------------------------
  webhook
    .command("list")
    .alias("ls")
    .description("List webhooks")
    .action(
      action(async (ctx: Context) => {
        const rows = await svc.listWebhooks(ctx.client, ctx.limit);
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  // view --------------------------------------------------------------------
  webhook
    .command("view <id>", { isDefault: true })
    .alias("show")
    .description("Show a webhook")
    .action(
      action(async (ctx: Context, _opts, idArg: string) => {
        const detail = await svc.getWebhookDetail(ctx.client, idArg);
        ctx.output.detail(detail, [
          ["Webhook", detail.id],
          ["URL", detail.url],
          ["Enabled", detail.enabled ? "yes" : "no"],
          ["Resources", detail.resourceTypes.length ? detail.resourceTypes.join(", ") : null],
          ["Label", detail.label],
          ["All public teams", detail.allPublicTeams ? "yes" : "no"],
          ["Team", detail.team],
          ["Creator", detail.creator],
          ["Created", detail.createdAt],
          ["Updated", detail.updatedAt],
        ]);
      }),
    );

  // create ------------------------------------------------------------------
  webhook
    .command("create")
    .alias("new")
    .description("Create a webhook (scope to the global --team, or --all-public)")
    .option("--url <url>", "destination URL that receives event payloads")
    .option("--resource <type...>", "resource type to subscribe to (repeatable)", collectArray)
    .option("--label <label>", "human-readable label for the webhook")
    .option("--all-public", "subscribe to all public teams in the workspace")
    .option("--secret <secret>", "secret used to sign webhook payloads")
    .action(
      action(async (ctx: Context, opts) => {
        if (!opts.url) throw usageError("A webhook needs a --url.");
        const resourceTypes: string[] = opts.resource ?? [];
        if (!resourceTypes.length)
          throw usageError("Pass at least one --resource (e.g. Issue, Comment, Project).");
        const created = await svc.createWebhook(ctx.client, {
          url: opts.url,
          resourceTypes,
          // The global -t/--team scopes the webhook; never combined with --all-public.
          team: opts.allPublic ? undefined : ctx.defaultTeam,
          label: opts.label,
          allPublicTeams: opts.allPublic,
          secret: opts.secret,
        });
        ctx.output.emit(
          { id: created.id, url: created.url, enabled: created.enabled, resourceTypes: created.resourceTypes },
          () => ctx.output.success(`Created webhook ${created.id}`),
        );
      }),
    );

  // update ------------------------------------------------------------------
  webhook
    .command("update <id>")
    .alias("edit")
    .description("Update a webhook")
    .option("--url <url>", "new destination URL")
    .option("--enabled", "enable the webhook")
    .option("--disabled", "disable the webhook")
    .option("--resource <type...>", "set resource types (repeatable)", collectArray)
    .option("--label <label>", "new label")
    .option("--secret <secret>", "new signing secret")
    .action(
      action(async (ctx: Context, opts, idArg: string) => {
        if (opts.enabled && opts.disabled)
          throw usageError("Pass only one of --enabled / --disabled.");
        const enabled = opts.enabled ? true : opts.disabled ? false : undefined;
        const updated = await svc.updateWebhook(ctx.client, idArg, {
          url: opts.url,
          enabled,
          resourceTypes: opts.resource,
          label: opts.label,
          secret: opts.secret,
        });
        ctx.output.emit(
          { id: updated.id, url: updated.url, enabled: updated.enabled, resourceTypes: updated.resourceTypes },
          () => ctx.output.success(`Updated webhook ${updated.id}`),
        );
      }),
    );

  // delete ------------------------------------------------------------------
  webhook
    .command("delete <id>")
    .alias("rm")
    .description("Delete a webhook")
    .action(
      action(async (ctx: Context, _opts, idArg: string) => {
        const wh = await svc.getWebhookDetail(ctx.client, idArg);
        if (!(await confirmDestructive(ctx, `Delete webhook ${wh.id} (${wh.url ?? "no url"})?`)))
          return;
        const deleted = await svc.deleteWebhook(ctx.client, wh.id);
        ctx.output.emit({ id: deleted.id, deleted: true }, () =>
          ctx.output.success(`Deleted webhook ${deleted.id}`),
        );
      }),
    );
}
