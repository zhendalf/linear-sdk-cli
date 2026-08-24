/**
 * `linear notification` (alias `notif`) — work with the viewer's notifications.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { confirmDestructive } from "../lib/prompt.js";
import type { Context } from "../context.js";
import * as svc from "../services/notification.js";
import type { Column } from "../output/table.js";
import { ExitCode } from "../lib/errors.js";

const ROW_COLUMNS: Column<svc.NotificationRow>[] = [
  { key: "type", header: "Type", value: (r) => r.type, max: 24 },
  { key: "subject", header: "Subject", value: (r) => r.subject ?? "—", max: 50 },
  { key: "read", header: "Read", value: (r) => (r.read ? "✓" : "•") },
  { key: "createdAt", header: "Created", value: (r) => r.createdAt.slice(0, 10) },
];

export function registerNotification(program: Command): void {
  const notification = program
    .command("notification")
    .alias("notif")
    .description("Work with your notifications");

  // list --------------------------------------------------------------------
  notification
    .command("list")
    .alias("ls")
    .description("List your notifications")
    .option("--include-archived", "include archived notifications")
    .action(
      action(async (ctx: Context, opts) => {
        const rows = await svc.listNotifications(ctx.client, ctx.limit, !!opts.includeArchived);
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  // read --------------------------------------------------------------------
  notification
    .command("read <id>")
    .description("Mark a notification as read")
    .action(
      action(async (ctx: Context, _opts, id: string) => {
        // The service throws unless the API confirmed the write, so this
        // receipt is what happened rather than what was asked for.
        const n = await svc.setRead(ctx.client, id, true);
        ctx.output.emit(n, () => ctx.output.success(`Marked ${n.id} read`));
      }),
    );

  // unread ------------------------------------------------------------------
  notification
    .command("unread <id>")
    .description("Mark a notification as unread")
    .action(
      action(async (ctx: Context, _opts, id: string) => {
        const n = await svc.setRead(ctx.client, id, false);
        ctx.output.emit(n, () => ctx.output.success(`Marked ${n.id} unread`));
      }),
    );

  // read-all ----------------------------------------------------------------
  notification
    .command("read-all")
    .description("Mark all your notifications as read")
    .action(
      action(async (ctx: Context) => {
        const res = await svc.markAllRead(ctx.client);
        ctx.output.emit(res, () => {
          if (res.success) {
            ctx.output.success(`Marked ${res.count} of ${res.attempted} notification(s) read`);
          } else {
            ctx.output.warn(
              `Marked ${res.count} of ${res.attempted} notification(s) read; ${res.failed.length} failed`,
            );
            for (const f of res.failed) ctx.output.warn(`${f.id}: ${f.error}`);
          }
        });
        // A batch receipt belongs on stdout even when only part of the batch
        // succeeded, but exit zero would let `read-all && ...` treat that as a
        // complete success. Preserve the receipt and make the process outcome
        // unambiguous.
        if (!res.success) process.exitCode = ExitCode.Runtime;
      }),
    );

  // archive -----------------------------------------------------------------
  notification
    .command("archive <id>")
    .description("Archive a notification")
    .action(
      action(async (ctx: Context, _opts, id: string) => {
        if (!(await confirmDestructive(ctx, `Archive notification ${id}?`))) return;
        const success = await svc.archiveNotification(ctx.client, id);
        ctx.output.emit({ id, archived: success }, () => ctx.output.success(`Archived ${id}`));
      }),
    );

  // snooze ------------------------------------------------------------------
  notification
    .command("snooze <id> <untilISO>")
    .description("Snooze a notification until an ISO timestamp (e.g. 2026-07-01T09:00:00Z)")
    .action(
      action(async (ctx: Context, _opts, id: string, untilISO: string) => {
        const n = await svc.snoozeNotification(ctx.client, id, untilISO);
        ctx.output.emit(n, () => ctx.output.success(`Snoozed ${n.id} until ${untilISO}`));
      }),
    );
}
