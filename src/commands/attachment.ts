/**
 * `linear attachment` (alias `at`) — list, create, and delete issue attachments.
 *
 * `list`/`create` take an issue reference (identifier like TES-123 or a UUID),
 * resolved via `resolveIssue`. `delete` takes an attachment id (UUID).
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { confirmDestructive } from "../lib/prompt.js";
import type { Context } from "../context.js";
import * as svc from "../services/attachment.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.AttachmentRow>[] = [
  { key: "title", header: "Title", value: (r) => r.title, max: 40 },
  { key: "url", header: "URL", value: (r) => r.url, max: 50 },
  { key: "source", header: "Source", value: (r) => r.source ?? "—", max: 16 },
];

export function registerAttachment(program: Command): void {
  const attachment = program
    .command("attachment")
    .alias("at")
    .description("Work with issue attachments");

  // list --------------------------------------------------------------------
  attachment
    .command("list <issue>")
    .alias("ls")
    .description("List the attachments on an issue")
    .action(
      action(async (ctx: Context, _opts, issueArg: string) => {
        const rows = await svc.listAttachments(ctx.client, issueArg, ctx.limit);
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  // create ------------------------------------------------------------------
  attachment
    .command("create <issue>")
    .alias("new")
    .description("Attach a URL to an issue")
    .requiredOption("--url <url>", "the URL to attach")
    .requiredOption("--title <title>", "attachment title")
    .option("--subtitle <text>", "attachment subtitle")
    .action(
      action(async (ctx: Context, opts, issueArg: string) => {
        const created = await svc.createAttachment(ctx.client, issueArg, {
          url: opts.url,
          title: opts.title,
          subtitle: opts.subtitle,
        });
        ctx.output.emit({ id: created.id, title: created.title, url: created.url }, () =>
          ctx.output.success(`Created attachment ${created.title}`),
        );
      }),
    );

  // delete ------------------------------------------------------------------
  attachment
    .command("delete <id>")
    .alias("rm")
    .description("Delete an attachment by id")
    .action(
      action(async (ctx: Context, _opts, id: string) => {
        if (!(await confirmDestructive(ctx, `Delete attachment ${id}?`))) return;
        const deleted = await svc.deleteAttachment(ctx.client, id);
        ctx.output.emit({ id: deleted.id, title: deleted.title, deleted: true }, () =>
          ctx.output.success(`Deleted attachment ${deleted.title}`),
        );
      }),
    );
}
