/**
 * Comment service: all SDK access for comments lives here so commands stay thin.
 *
 * Lists go through the issue's typed `comments()` connection. The mutations use
 * the typed SDK and unwrap the `{ success, comment }` payloads.
 *
 * NOTE: the typed `client.comment(id)` getter is broken in @linear/sdk v87 (it
 * mis-serializes the id as the GraphQL `variables` body), so the one place we
 * need to look a comment up by id — to learn a reply's parent issue — uses a
 * tailored rawRequest instead.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { pageSize } from "../lib/pagination.js";
import { usageError, notFound } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import { resolveIssue } from "../lib/resolve.js";

export interface CommentRow {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  url: string;
}

const LIST_QUERY = `
query CliComments($id: String!, $first: Int!, $after: String) {
  issue(id: $id) {
    comments(first: $first, after: $after) {
      nodes { id body createdAt url user { displayName } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/**
 * List the comments on an issue (resolved by identifier/UUID). Uses a tailored
 * GraphQL query so the author name is fetched inline (no per-comment N+1).
 */
export async function listComments(
  client: LinearClient,
  issueArg: string,
  limit: number,
): Promise<CommentRow[]> {
  const issue = await resolveIssue(client, issueArg);
  const rows: CommentRow[] = [];
  let after: string | undefined;
  for (;;) {
    const data: any = await withRetry(() =>
      (client.client as any).rawRequest(LIST_QUERY, { id: issue.id, first: pageSize(limit), after }),
    );
    const conn = data.data.issue?.comments;
    if (!conn) break;
    for (const c of conn.nodes) {
      rows.push({
        id: c.id,
        body: c.body,
        author: c.user?.displayName ?? "unknown",
        createdAt: c.createdAt,
        url: c.url,
      });
      if (rows.length >= limit) break;
    }
    if (rows.length >= limit || !conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return rows;
}

/** Add a comment to an issue. */
export async function addComment(client: LinearClient, issueArg: string, body: string) {
  const issue = await resolveIssue(client, issueArg);
  const comment = await unwrapMutation(
    withRetry(() => client.createComment({ issueId: issue.id, body })),
    "comment",
    "Comment creation",
  );
  return { issue, comment };
}

const PARENT_QUERY = `
query CliCommentParent($id: String!) {
  comment(id: $id) {
    id
    issueId
    issue { id identifier }
  }
}`;

interface ParentComment {
  id: string;
  issueId: string | null;
  issue: { id: string; identifier: string } | null;
}

/**
 * Reply to an existing comment. Linear nests replies via `parentId`, but the API
 * still requires the owning entity, so we look the parent up (for its issueId)
 * and pass both. Returns the new comment plus the parent's issue for output.
 */
export async function replyToComment(client: LinearClient, commentId: string, body: string) {
  const parent = await getParent(client, commentId);
  if (!parent.issueId) throw usageError("Can only reply to comments that belong to an issue.");
  const comment = await unwrapMutation(
    withRetry(() => client.createComment({ parentId: parent.id, issueId: parent.issueId!, body })),
    "comment",
    "Reply creation",
  );
  return { parent, comment, issue: parent.issue };
}

export async function updateComment(client: LinearClient, commentId: string, body: string) {
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

/** Look a comment up by id via rawRequest (the typed getter is broken in v87). */
async function getParent(client: LinearClient, commentId: string): Promise<ParentComment> {
  const data: any = await withRetry(() =>
    (client.client as any).rawRequest(PARENT_QUERY, { id: commentId }),
  );
  const node = data?.data?.comment;
  if (!node) throw notFound(`No comment with id '${commentId}'.`);
  return { id: node.id, issueId: node.issueId ?? null, issue: node.issue ?? null };
}
