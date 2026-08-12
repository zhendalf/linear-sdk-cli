/**
 * `linear user` (alias `u`) — inspect workspace users. Read-only group.
 *
 * `view` accepts `me`, an email, a display/full name, or an id (all handled by
 * `resolveUserId`); `me` is a convenience alias for `view me`.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import type { Context } from "../context.js";
import * as svc from "../services/user.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.UserRow>[] = [
  { key: "displayName", header: "Name", value: (r) => r.displayName, max: 24 },
  { key: "email", header: "Email", value: (r) => r.email, max: 40 },
  { key: "active", header: "Active", value: (r) => (r.active ? "yes" : "no") },
  { key: "admin", header: "Admin", value: (r) => (r.admin ? "yes" : "no") },
];

export function registerUser(program: Command): void {
  const user = program.command("user").alias("u").description("Inspect workspace users");

  // list --------------------------------------------------------------------
  user
    .command("list")
    .alias("ls")
    .description("List workspace users")
    .option("--include-disabled", "include deactivated users (excluded by default)")
    .action(
      action(async (ctx: Context, opts) => {
        const rows = await svc.listUsers(ctx.client, ctx.limit, !!opts.includeDisabled);
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  // view --------------------------------------------------------------------
  user
    .command("view <who>")
    .description("Show a user (me, email, name, or id)")
    .action(
      action(async (ctx: Context, _opts, who: string) => {
        const detail = await svc.getUserDetail(ctx.client, who);
        emitDetail(ctx, detail);
      }),
    );

  // me ----------------------------------------------------------------------
  user
    .command("me")
    .description("Show the authenticated viewer")
    .action(
      action(async (ctx: Context) => {
        const detail = await svc.getViewer(ctx.client);
        emitDetail(ctx, detail);
      }),
    );
}

function emitDetail(ctx: Context, detail: svc.UserDetail): void {
  ctx.output.detail(detail, [
    ["User", `${detail.displayName}  ${detail.name}`],
    ["ID", detail.id],
    ["Email", detail.email],
    ["Active", detail.active ? "yes" : "no"],
    ["Admin", detail.admin ? "yes" : "no"],
    ["Guest", detail.guest ? "yes" : "no"],
    ["You", detail.isMe ? "yes" : null],
    ["Status", detail.statusLabel],
    ["Description", detail.description],
    ["Timezone", detail.timezone],
    ["Last seen", detail.lastSeen],
    ["URL", detail.url],
    ["Created", detail.createdAt],
    ["Updated", detail.updatedAt],
  ]);
}
