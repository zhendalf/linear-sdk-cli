/**
 * `linear organization` (alias `org`) — inspect the current workspace.
 *
 * A read-only group: `view` shows workspace details, `members` lists workspace
 * users, and `invites` lists pending organization invites. Admin/destructive
 * operations are intentionally out of scope.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import type { Context } from "../context.js";
import * as svc from "../services/organization.js";
import type { Column } from "../output/table.js";

const MEMBER_COLUMNS: Column<svc.MemberRow>[] = [
  { key: "name", header: "Name", value: (r) => r.displayName, max: 24 },
  { key: "email", header: "Email", value: (r) => r.email, max: 40 },
  { key: "admin", header: "Admin", value: (r) => (r.admin ? "yes" : "no") },
  { key: "active", header: "Active", value: (r) => (r.active ? "yes" : "no") },
];

const INVITE_COLUMNS: Column<svc.InviteRow>[] = [
  { key: "email", header: "Email", value: (r) => r.email, max: 40 },
  { key: "status", header: "Status", value: (r) => r.status },
  { key: "role", header: "Role", value: (r) => r.role },
];

export function registerOrganization(program: Command): void {
  const org = program
    .command("organization")
    .alias("org")
    .description("Inspect the current workspace");

  // view --------------------------------------------------------------------
  org
    .command("view", { isDefault: true })
    .alias("show")
    .description("Show the current workspace")
    .action(
      action(async (ctx: Context) => {
        const detail = await svc.getOrganizationDetail(ctx.client);
        ctx.output.detail(detail, [
          ["Workspace", detail.name],
          ["URL key", detail.urlKey],
          ["ID", detail.id],
          ["Users", detail.userCount],
          ["Issues created", detail.createdIssueCount],
          ["SAML", detail.samlEnabled ? "yes" : "no"],
          ["SCIM", detail.scimEnabled ? "yes" : "no"],
          ["Roadmaps", detail.roadmapEnabled ? "yes" : "no"],
          ["Logo", detail.logoUrl],
          ["Created", detail.createdAt],
          ["Updated", detail.updatedAt],
        ]);
      }),
    );

  // members -----------------------------------------------------------------
  org
    .command("members")
    .description("List workspace members")
    .action(
      action(async (ctx: Context) => {
        const rows = await svc.listMembers(ctx.client, ctx.limit);
        ctx.output.list(rows, MEMBER_COLUMNS, rows);
      }),
    );

  // invites -----------------------------------------------------------------
  org
    .command("invites")
    .description("List organization invites")
    .action(
      action(async (ctx: Context) => {
        const rows = await svc.listInvites(ctx.client, ctx.limit);
        ctx.output.list(rows, INVITE_COLUMNS, rows);
      }),
    );
}
