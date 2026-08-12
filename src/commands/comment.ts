/**
 * `linear comment` (alias `cm`) — manage comments by id beyond the basic
 * `linear issue comment` add (Phase 1). Adds reply, update, delete, and
 * resolve/unresolve, plus a standalone `list <issue>`.
 *
 * Comment ids are UUIDs; the `<issue>` argument accepts an identifier (TES-123)
 * or a UUID and is resolved via resolveIssue.
 *
 * The four core verbs are built by factories rather than registered inline, so
 * the `linear issue comment {add,list,update,delete}` subgroup (the reference
 * CLI's layout) can mount the *same* handlers under `issue` without a second
 * copy of the logic. Commander commands carry a parent pointer, so each mount
 * point needs its own instance — hence factories, not shared constants.
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

/** Options for a mounted copy of the shared verbs. */
interface MountOptions {
  /** Register the short aliases (`ls`, `edit`, `rm`). Off under `issue comment`. */
  aliases?: boolean;
}

function buildList(o: MountOptions): Command {
  const cmd = new Command("list").argument("<issue>").description("List comments on an issue");
  if (o.aliases !== false) cmd.alias("ls");
  return cmd.action(
    action(async (ctx: Context, _opts, issueArg: string) => {
      const rows = await svc.listComments(ctx.client, issueArg, ctx.limit);
      ctx.output.list(rows, ROW_COLUMNS, rows);
    }),
  );
}

function buildAdd(_o: MountOptions): Command {
  return new Command("add")
    .argument("<issue>")
    .argument("[body]")
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
}

function buildUpdate(o: MountOptions): Command {
  const cmd = new Command("update")
    .argument("<commentId>")
    .argument("[body]")
    .description("Update a comment's body")
    .option("--body-file <path>", "read new body from a file ('-' = stdin)");
  if (o.aliases !== false) cmd.alias("edit");
  return cmd.action(
    action(async (ctx: Context, opts, commentId: string, bodyArg?: string) => {
      const body = resolveBody({ arg: bodyArg, file: opts.bodyFile, interactive: ctx.isTTY });
      if (body === undefined) throw usageError("No comment body provided.");
      const updated = await svc.updateComment(ctx.client, commentId, body);
      ctx.output.emit({ id: updated.id, url: updated.url }, () =>
        ctx.output.success(`Updated comment ${updated.id}`),
      );
    }),
  );
}

function buildDelete(o: MountOptions): Command {
  const cmd = new Command("delete").argument("<commentId>").description("Delete a comment");
  if (o.aliases !== false) cmd.alias("rm");
  return cmd.action(
    action(async (ctx: Context, _opts, commentId: string) => {
      if (!(await confirmDestructive(ctx, `Delete comment ${commentId}?`))) return;
      const deleted = await svc.deleteComment(ctx.client, commentId);
      ctx.output.emit({ id: deleted.id, deleted: true }, () =>
        ctx.output.success(`Deleted comment ${deleted.id}`),
      );
    }),
  );
}

/** The four verbs the reference CLI mounts under `issue comment`. */
export const SHARED_COMMENT_VERBS = {
  add: buildAdd,
  list: buildList,
  update: buildUpdate,
  delete: buildDelete,
} as const;

export function registerComment(program: Command): void {
  const comment = program.command("comment").alias("cm").description("Manage comments");

  // add / list / update / delete — shared with `issue comment` -----------------
  for (const build of Object.values(SHARED_COMMENT_VERBS)) comment.addCommand(build({}));

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

/**
 * Mount `add`/`list`/`update`/`delete` under the existing `issue comment`
 * command, which keeps its own `[id] [body]` "add a comment" behavior for every
 * other operand. The short aliases (`ls`, `edit`, `rm`) are deliberately NOT
 * registered here: each subcommand name shadows a one-word comment body under
 * the parent, so the collision surface stays at the four names the reference
 * actually ships.
 */
export function registerIssueCommentGroup(issueComment: Command): void {
  for (const build of Object.values(SHARED_COMMENT_VERBS)) {
    issueComment.addCommand(build({ aliases: false }));
  }
}
