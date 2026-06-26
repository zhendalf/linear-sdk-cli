/**
 * Attachment service: all SDK access for attachments lives here so commands
 * stay thin.
 *
 * Listing goes through the typed `issue.attachments()` connection on a resolved
 * issue; `create` unwraps the `{ success, attachment }` payload and `delete`
 * removes by id.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { collect, pageSize } from "../lib/pagination.js";
import { usageError, notFound } from "../lib/errors.js";
import { resolveIssue } from "../lib/resolve.js";

export interface AttachmentRow {
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
  source: string | null;
  createdAt: string;
}

/** Derive a human-friendly source label from the Attachment's source/sourceType. */
export function sourceLabel(a: any): string | null {
  if (a.sourceType) return String(a.sourceType);
  const src = a.source;
  if (src && typeof src === "object" && typeof src.type === "string") return src.type;
  if (typeof src === "string") return src;
  return null;
}

function toRow(a: any): AttachmentRow {
  return {
    id: a.id,
    title: a.title,
    subtitle: a.subtitle ?? null,
    url: a.url,
    source: sourceLabel(a),
    createdAt: dateStr(a.createdAt),
  };
}

/** List the attachments on an issue (resolved from identifier or UUID). */
export async function listAttachments(
  client: LinearClient,
  issueArg: string,
  limit: number,
): Promise<AttachmentRow[]> {
  const issue = await resolveIssue(client, issueArg);
  const conn = await withRetry(() => issue.attachments({ first: pageSize(limit) }));
  const nodes = await collect(conn as any, limit);
  return nodes.map(toRow);
}

export interface CreateOptions {
  url: string;
  title: string;
  subtitle?: string;
}

/** Create an attachment on an issue, unwrapping the `{ success, attachment }` payload. */
export async function createAttachment(
  client: LinearClient,
  issueArg: string,
  opts: CreateOptions,
) {
  const issue = await resolveIssue(client, issueArg);
  const input: Record<string, any> = {
    issueId: issue.id,
    url: opts.url,
    title: opts.title,
  };
  if (opts.subtitle !== undefined) input.subtitle = opts.subtitle;

  const payload = await withRetry(() => client.createAttachment(input as any));
  const attachment = await payload.attachment;
  if (!attachment) throw usageError("Attachment creation returned no attachment.");
  return attachment;
}

/** Delete an attachment by id; returns the removed attachment's id/title. */
export async function deleteAttachment(client: LinearClient, id: string) {
  const attachment = await withRetry(() => client.attachment(id));
  if (!attachment) throw notFound(`No attachment ${id}.`);
  await withRetry(() => client.deleteAttachment(id));
  return { id: attachment.id, title: attachment.title };
}

/** Normalize a Date (SDK model) or string into an ISO string. */
export function dateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
