/**
 * `linear notification` (alias `notif`) — work with the viewer's notifications.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { confirmDestructive } from "../lib/prompt.js";
import type { Context } from "../context.js";
import * as svc from "../services/notification.js";
import type { Column } from "../output/table.js";

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
        const n = await svc.setRead(ctx.client, id, true);
        ctx.output.emit({ id: n.id, read: true }, () =>
          ctx.output.success(`Marked ${n.id} read`),
        );
      }),
    );

  // unread ------------------------------------------------------------------
  notification
    .command("unread <id>")
    .description("Mark a notification as unread")
    .action(
      action(async (ctx: Context, _opts, id: string) => {
        const n = await svc.setRead(ctx.client, id, false);
        ctx.output.emit({ id: n.id, read: false }, () =>
          ctx.output.success(`Marked ${n.id} unread`),
        );
      }),
    );

  // read-all ----------------------------------------------------------------
  notification
    .command("read-all")
    .description("Mark all your notifications as read")
    .action(
      action(async (ctx: Context) => {
        const res = await svc.markAllRead(ctx.client);
        ctx.output.emit(res, () => ctx.output.success(`Marked ${res.count} notification(s) read`));
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
        ctx.output.emit({ id, archived: success }, () =>
          ctx.output.success(`Archived ${id}`),
        );
      }),
    );

  // snooze ------------------------------------------------------------------
  notification
    .command("snooze <id> <untilISO>")
    .description("Snooze a notification until an ISO timestamp (e.g. 2026-07-01T09:00:00Z)")
    .action(
      action(async (ctx: Context, _opts, id: string, untilISO: string) => {
        const n = await svc.snoozeNotification(ctx.client, id, untilISO);
        ctx.output.emit({ id: n.id, snoozedUntilAt: untilISO }, () =>
          ctx.output.success(`Snoozed ${n.id} until ${untilISO}`),
        );
      }),
    );
}
