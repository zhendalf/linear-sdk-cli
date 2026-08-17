/**
 * Comment service: all SDK access for comments lives here so commands stay thin.
 *
 * This is the ONE comment implementation: `comment add|list|update|delete|reply`,
 * `issue comment`, `issue comments`, and `issue view --comments` all come here.
 * There used to be a second copy in the issue service (typed SDK, one request
 * per comment for the author, and a different JSON shape — `user` string vs
 * `author` string, no `url`), which is exactly how the same data came out with
 * two key sets depending on which command asked for it.
 *
 * Lists use a tailored GraphQL query so the author, thread parent and resolved
 * state are fetched inline (one round-trip per page). The mutations use the
 * typed SDK and unwrap the `{ success, comment }` payloads.
 *
 * NOTE: the typed `client.comment(id)` getter is broken in @linear/sdk v87 (it
 * mis-serializes the id as the GraphQL `variables` body), so looking a comment
 * up by id — to learn a reply's parent issue, or the current body before an
 * edit — uses a tailored rawRequest instead.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { shape } from "../lib/shape.js";
import { collectRawQuery } from "../lib/pagination.js";
import { usageError, notFound } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import { resolveIssue } from "../lib/resolve.js";
import { appendEmbeds, uploadFile, validateUploads, type UploadResult } from "../lib/upload.js";

export interface CommentRow {
  id: string;
  body: string;
  /** The author — an object like every other list row's relations; null for a deleted account. */
  user: { id: string; displayName: string } | null;
  createdAt: string;
  /** Set once the body has been edited; null for a comment as first written. */
  editedAt: string | null;
  /** Set when the thread has been resolved (`comment resolve`); null while open. */
  resolvedAt: string | null;
  /** The comment this one replies to (`comment reply`); null for a top-level comment. */
  parent: { id: string } | null;
  url: string;
}

/** The row's shape as `linear commands` advertises it (TES-610); checked against the interface. */
export const COMMENT_ROW_SHAPE = shape<CommentRow>({
  id: "string",
  body: "string",
  user: { nullable: { id: "string", displayName: "string" } },
  createdAt: "string",
  editedAt: "string|null",
  resolvedAt: "string|null",
  parent: { nullable: { id: "string" } },
  url: "string",
});

const LIST_QUERY = `
query CliComments($id: String!, $first: Int!, $after: String) {
  issue(id: $id) {
    comments(first: $first, after: $after) {
      nodes {
        id body createdAt editedAt resolvedAt url
        user { id displayName }
        parent { id }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/**
 * List the comments on an issue (resolved by identifier/UUID), in thread order:
 * top-level comments as the API returns them (newest first), each followed by
 * its replies oldest-first, so a thread reads top to bottom.
 */
export async function listComments(
  client: LinearClient,
  issueArg: string,
  limit: number,
): Promise<CommentRow[]> {
  const issue = await resolveIssue(client, issueArg);
  const rows = await collectRawQuery<CommentRow>(
    client as any,
    LIST_QUERY,
    { id: issue.id },
    "issue.comments",
    limit,
    toCommentRow,
  );
  return threadOrder(rows);
}

/** Map a tailored-query comment node to a row. Exported for tests. */
export function toCommentRow(c: any): CommentRow {
  return {
    id: c.id,
    body: c.body,
    user: c.user ? { id: c.user.id, displayName: c.user.displayName } : null,
    createdAt: c.createdAt,
    editedAt: c.editedAt ?? null,
    resolvedAt: c.resolvedAt ?? null,
    parent: c.parent ? { id: c.parent.id } : null,
    url: c.url,
  };
}

/**
 * Group replies under their parent. Top-level rows keep their incoming order;
 * replies follow their parent oldest-first. A reply whose parent is not in the
 * page (it fell outside `--limit`) stays where it was, still marked by
 * `parent`, rather than being dropped. Exported for tests.
 */
export function threadOrder(rows: CommentRow[]): CommentRow[] {
  const ids = new Set(rows.map((r) => r.id));
  const replies = new Map<string, CommentRow[]>();
  for (const r of rows) {
    if (r.parent && ids.has(r.parent.id)) {
      const list = replies.get(r.parent.id) ?? [];
      list.push(r);
      replies.set(r.parent.id, list);
    }
  }
  const out: CommentRow[] = [];
  for (const r of rows) {
    if (r.parent && ids.has(r.parent.id)) continue; // emitted under its parent
    out.push(r);
    const kids = replies.get(r.id);
    if (kids) out.push(...kids.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }
  return out;
}

export interface AddCommentOptions {
  /**
   * `--attach <file>` (repeatable): files to upload and embed in the body — a
   * blank line after it, then one markdown embed per line (images inline,
   * anything else as a link). Validated as a batch before any is uploaded.
   */
  attachments?: string[];
  /** Upload the attachments to public, world-readable URLs (raster images only). */
  public?: boolean;
}

/** Add a comment to an issue, optionally with uploaded files embedded in it. */
export async function addComment(
  client: LinearClient,
  issueArg: string,
  body: string,
  opts: AddCommentOptions = {},
) {
  const paths = opts.attachments ?? [];
  // Every file first — a missing one fails before anything is uploaded or resolved.
  validateUploads(paths, { public: opts.public });
  const issue = await resolveIssue(client, issueArg);
  const uploads: UploadResult[] = [];
  for (const path of paths) uploads.push(await uploadFile(client, path, { public: opts.public }));
  const comment = await unwrapMutation(
    withRetry(() => client.createComment({ issueId: issue.id, body: appendEmbeds(body, uploads) })),
    "comment",
    "Comment creation",
  );
  return { issue, comment, uploads };
}

const LOOKUP_QUERY = `
query CliCommentLookup($id: String!) {
  comment(id: $id) {
    id
    body
    issueId
    issue { id identifier }
  }
}`;

export interface CommentLookup {
  id: string;
  body: string;
  issueId: string | null;
  issue: { id: string; identifier: string } | null;
}

/**
 * Reply to an existing comment. Linear nests replies via `parentId`, but the API
 * still requires the owning entity, so we look the parent up (for its issueId)
 * and pass both. Returns the new comment plus the parent's issue for output.
 */
export async function replyToComment(client: LinearClient, commentId: string, body: string) {
  const parent = await getComment(client, commentId);
  if (!parent.issueId) throw usageError("Can only reply to comments that belong to an issue.");
  const comment = await unwrapMutation(
    withRetry(() => client.createComment({ parentId: parent.id, issueId: parent.issueId!, body })),
    "comment",
    "Reply creation",
  );
  return { parent, comment, issue: parent.issue };
}

/**
 * Replace a comment's body. An empty or whitespace-only body is refused: the
 * only way to produce one from the CLI is quitting a blank editor or passing
 * `""`, and neither is a request to blank a comment (there is `comment delete`
 * for getting rid of one). An unchanged body is refused too, so an editor
 * session closed without edits does not write a no-op — and does not stamp
 * `editedAt` on a comment nobody edited.
 */
export async function updateComment(
  client: LinearClient,
  commentId: string,
  body: string,
  current?: string,
) {
  if (body.trim() === "") {
    throw usageError("Refusing to blank the comment body. To remove a comment, use 'comment delete'.");
  }
  if (current !== undefined && body === current) throw usageError("Comment body unchanged; nothing to update.");
  return unwrapMutation(
    withRetry(() => client.updateComment(commentId, { body })),
    "comment",
    "Comment update",
  );
}

export async function deleteComment(client: LinearClient, commentId: string) {
  await assertMutation(withRetry(() => client.deleteComment(commentId)), "Comment deletion");
  return { id: commentId };
}

/** Resolve (or unresolve) a comment thread. */
export async function setResolved(client: LinearClient, commentId: string, resolved: boolean) {
  return unwrapMutation(
    withRetry(() => (resolved ? client.commentResolve(commentId) : client.commentUnresolve(commentId))),
    "comment",
    `Comment ${resolved ? "resolve" : "unresolve"}`,
  );
}

/**
 * Look a comment up by id via rawRequest (the typed getter is broken in v87):
 * its current body, and the issue it belongs to. Used to seed the editor for
 * `comment update` and to find a reply's owning issue.
 */
export async function getComment(client: LinearClient, commentId: string): Promise<CommentLookup> {
  const data: any = await withRetry(() =>
    (client.client as any).rawRequest(LOOKUP_QUERY, { id: commentId }),
  );
  const node = data?.data?.comment;
  if (!node) throw notFound(`No comment with id '${commentId}'.`);
  return {
    id: node.id,
    body: node.body ?? "",
    issueId: node.issueId ?? null,
    issue: node.issue ?? null,
  };
}
