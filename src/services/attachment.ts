/**
 * Attachment service: all SDK access for attachments lives here so commands
 * stay thin.
 *
 * Listing goes through the typed `issue.attachments()` connection on a resolved
 * issue; `create` unwraps the `{ success, attachment }` payload and `delete`
 * removes by id. `attachFiles` is `issue attach`: upload each file (see
 * `lib/upload.ts`), then attach it by its asset URL.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { shape } from "../lib/shape.js";
import { collect, inheritPaginationMetadata, pageSize } from "../lib/pagination.js";
import { notFound, usageError } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import { resolveIssue } from "../lib/resolve.js";
import { appendEmbeds, uploadFile, validateUploads, type UploadResult } from "../lib/upload.js";

export interface AttachmentRow {
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
  source: string | null;
  createdAt: string;
}

/** The row's shape as `linear commands` advertises it (TES-610); checked against the interface. */
export const ATTACHMENT_ROW_SHAPE = shape<AttachmentRow>({
  id: "string",
  title: "string",
  subtitle: "string|null",
  url: "string",
  source: "string|null",
  createdAt: "string",
});

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
  return inheritPaginationMetadata(nodes.map(toRow), nodes);
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

  return unwrapMutation(
    withRetry(() => client.createAttachment(input as any)),
    "attachment",
    "Attachment creation",
  );
}

export interface AttachFilesOptions {
  /** Attachment title; only meaningful for a single file (default: the filename). */
  title?: string;
  /** Also post one comment with this body, embedding every file as markdown. */
  comment?: string;
  /** Upload to public, world-readable URLs (raster images only). Default: private. */
  public?: boolean;
  /** Called as each file is attached (with the resolved issue), for progress output. */
  onAttached?: (attached: AttachedFile, issue: { id: string; identifier: string }) => void;
}

/** One uploaded-and-attached file: the attachment plus what was uploaded. */
export interface AttachedFile extends UploadResult {
  id: string;
  title: string;
  url: string;
}

/**
 * `issue attach <issue> <file...>`: upload each file to Linear's storage and
 * attach it to the issue by its asset URL. Every file is validated first — it
 * exists, is readable, and (with `public`) is a type Linear serves publicly —
 * so a typo in file 3 does not leave files 1–2 uploaded and orphaned. Then the
 * issue is resolved (a bad id fails before any bytes move), and each file is
 * uploaded and attached in turn. `comment` posts ONE comment afterwards, its
 * body followed by a blank line and one markdown embed per file, so an image
 * shows inline in the thread as well as in the sidebar.
 */
export async function attachFiles(
  client: LinearClient,
  issueArg: string,
  paths: string[],
  opts: AttachFilesOptions,
): Promise<{
  issue: { id: string; identifier: string };
  attachments: AttachedFile[];
  comment?: { id: string; url: string };
}> {
  if (opts.title !== undefined && paths.length > 1) {
    throw usageError(
      "--title names a single attachment; with several files, drop it to use each file's name.",
    );
  }
  validateUploads(paths, { public: opts.public });
  const issue = await resolveIssue(client, issueArg);

  const attachments: AttachedFile[] = [];
  for (const path of paths) {
    const upload = await uploadFile(client, path, { public: opts.public });
    const attachment = await unwrapMutation(
      withRetry(() =>
        client.createAttachment({
          issueId: issue.id,
          url: upload.assetUrl,
          title: opts.title ?? upload.filename,
        }),
      ),
      "attachment",
      "Attachment creation",
    );
    const attached: AttachedFile = {
      ...upload,
      id: attachment.id,
      title: attachment.title,
      url: attachment.url,
    };
    attachments.push(attached);
    opts.onAttached?.(attached, issue);
  }

  let comment: { id: string; url: string } | undefined;
  if (opts.comment !== undefined) {
    const created = await unwrapMutation(
      withRetry(() =>
        client.createComment({ issueId: issue.id, body: appendEmbeds(opts.comment, attachments) }),
      ),
      "comment",
      "Comment creation",
    );
    comment = { id: created.id, url: created.url };
  }

  return { issue: { id: issue.id, identifier: issue.identifier }, attachments, comment };
}

/** Delete an attachment by id; returns the removed attachment's id/title. */
export async function deleteAttachment(client: LinearClient, id: string) {
  const attachment = await withRetry(() => client.attachment(id));
  if (!attachment) throw notFound(`No attachment ${id}.`);
  await assertMutation(
    withRetry(() => client.deleteAttachment(id)),
    "Attachment deletion",
  );
  return { id: attachment.id, title: attachment.title };
}

/** Normalize a Date (SDK model) or string into an ISO string. */
export function dateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
