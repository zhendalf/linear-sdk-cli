/**
 * `linear comment` (alias `cm`) — manage comments by id beyond the basic
 * `linear issue comment` add (Phase 1). Adds reply, update, delete, and
 * resolve/unresolve, plus a standalone `list <issue>`.
 *
 * Comment ids are UUIDs; the `<issue>` argument accepts an identifier (TES-123)
 * or a UUID and is resolved via resolveIssue.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { resolveBody } from "../lib/body.js";
import { confirmDestructive } from "../lib/prompt.js";
import { usageError } from "../lib/errors.js";
import type { Context } from "../context.js";
import * as svc from "../services/comment.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.CommentRow>[] = [
  { key: "createdAt", header: "Date", value: (r) => r.createdAt.slice(0, 10) },
  { key: "author", header: "Author", value: (r) => r.author, max: 18 },
  { key: "body", header: "Body", value: (r) => r.body.replace(/\n/g, " "), max: 70 },
];

export function registerComment(program: Command): void {
  const comment = program.command("comment").alias("cm").description("Manage comments");

  // list --------------------------------------------------------------------
  comment
    .command("list <issue>")
    .alias("ls")
    .description("List comments on an issue")
    .action(
      action(async (ctx: Context, _opts, issueArg: string) => {
        const rows = await svc.listComments(ctx.client, issueArg, ctx.limit);
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  // add ---------------------------------------------------------------------
  comment
    .command("add <issue> [body]")
    .description("Add a comment to an issue")
    .option("--body-file <path>", "read comment body from a file ('-' = stdin)")
    .action(
      action(async (ctx: Context, opts, issueArg: string, bodyArg?: string) => {
        const body = resolveBody({ arg: bodyArg, file: opts.bodyFile, interactive: ctx.isTTY });
        if (!body) throw usageError("No comment body provided.");
        const { issue, comment: created } = await svc.addComment(ctx.client, issueArg, body);
        ctx.output.emit({ id: created.id, issue: issue.identifier, url: created.url }, () =>
          ctx.output.success(`Commented on ${issue.identifier}`),
        );
      }),
    );

  // reply -------------------------------------------------------------------
  comment
    .command("reply <commentId> [body]")
    .description("Reply to a comment (nested under it)")
    .option("--body-file <path>", "read reply body from a file ('-' = stdin)")
    .action(
      action(async (ctx: Context, opts, commentId: string, bodyArg?: string) => {
        const body = resolveBody({ arg: bodyArg, file: opts.bodyFile, interactive: ctx.isTTY });
        if (!body) throw usageError("No reply body provided.");
        const { comment: created, issue } = await svc.replyToComment(ctx.client, commentId, body);
        ctx.output.emit(
          { id: created.id, parent: commentId, issue: issue?.identifier ?? null, url: created.url },
          () => ctx.output.success(`Replied to comment${issue ? ` on ${issue.identifier}` : ""}`),
        );
      }),
    );

  // update ------------------------------------------------------------------
  comment
    .command("update <commentId> [body]")
    .alias("edit")
    .description("Update a comment's body")
    .option("--body-file <path>", "read new body from a file ('-' = stdin)")
    .action(
      action(async (ctx: Context, opts, commentId: string, bodyArg?: string) => {
        const body = resolveBody({ arg: bodyArg, file: opts.bodyFile, interactive: ctx.isTTY });
        if (body === undefined) throw usageError("No comment body provided.");
        const updated = await svc.updateComment(ctx.client, commentId, body);
        ctx.output.emit({ id: updated.id, url: updated.url }, () =>
          ctx.output.success(`Updated comment ${updated.id}`),
        );
      }),
    );

  // delete ------------------------------------------------------------------
  comment
    .command("delete <commentId>")
    .alias("rm")
    .description("Delete a comment")
    .action(
      action(async (ctx: Context, _opts, commentId: string) => {
        if (!(await confirmDestructive(ctx, `Delete comment ${commentId}?`))) return;
        const deleted = await svc.deleteComment(ctx.client, commentId);
        ctx.output.emit({ id: deleted.id, deleted: true }, () =>
          ctx.output.success(`Deleted comment ${deleted.id}`),
        );
      }),
    );

  // resolve / unresolve -----------------------------------------------------
  comment
    .command("resolve <commentId>")
    .description("Resolve a comment thread")
    .action(
      action(async (ctx: Context, _opts, commentId: string) => {
        const c = await svc.setResolved(ctx.client, commentId, true);
        ctx.output.emit({ id: c.id, resolved: true }, () =>
          ctx.output.success(`Resolved comment ${c.id}`),
        );
      }),
    );

  comment
    .command("unresolve <commentId>")
    .description("Unresolve a comment thread")
    .action(
      action(async (ctx: Context, _opts, commentId: string) => {
        const c = await svc.setResolved(ctx.client, commentId, false);
        ctx.output.emit({ id: c.id, resolved: false }, () =>
          ctx.output.success(`Unresolved comment ${c.id}`),
        );
      }),
    );
}
