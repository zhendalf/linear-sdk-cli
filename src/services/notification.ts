/**
 * Notification service: all SDK access for the viewer's notifications lives here
 * so commands stay thin.
 *
 * The list uses a tailored GraphQL query with inline fragments on the
 * notification subtypes, so the human-facing "subject" (issue identifier/title,
 * project name, document title, …) is pulled in a single round-trip with no
 * N+1. Mutations use the typed SDK (updateNotification / archiveNotification /
 * notificationMarkReadAll).
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { shape } from "../lib/shape.js";
import { collectRawQuery } from "../lib/pagination.js";
import { assertMutation } from "../lib/mutation.js";
import { normalizeError, usageError } from "../lib/errors.js";

export interface NotificationRow {
  id: string;
  type: string;
  subject: string | null;
  read: boolean;
  readAt: string | null;
  snoozedUntilAt: string | null;
  archivedAt: string | null;
  createdAt: string;
}

/** The row's shape as `linear commands` advertises it (TES-610); checked against the interface. */
export const NOTIFICATION_ROW_SHAPE = shape<NotificationRow>({
  id: "string",
  type: "string",
  subject: "string|null",
  read: "boolean",
  readAt: "string|null",
  snoozedUntilAt: "string|null",
  archivedAt: "string|null",
  createdAt: "string",
});

const LIST_QUERY = `
query CliNotifications($first: Int!, $after: String, $includeArchived: Boolean) {
  notifications(first: $first, after: $after, includeArchived: $includeArchived) {
    nodes {
      __typename
      id type readAt snoozedUntilAt archivedAt createdAt
      ... on IssueNotification { issue { identifier title } comment { id } }
      ... on ProjectNotification { project { name } projectUpdate { id } }
      ... on DocumentNotification { documentId }
      ... on InitiativeNotification { initiative { name } }
      ... on CustomerNotification { customer { name } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Derive a short human "subject" line from the typed notification node. The base
 * Notification type has no title scalar in @linear/sdk v87, so we synthesize one
 * from the related entity. DocumentNotification exposes only `documentId` (no
 * nested document relation), so document notifications fall back to that id.
 */
function subjectOf(n: any): string | null {
  if (n.issue) {
    const id = n.issue.identifier;
    const title = n.issue.title;
    return id && title ? `${id} ${title}` : (id ?? title ?? null);
  }
  if (n.project?.name) return n.project.name;
  if (n.initiative?.name) return n.initiative.name;
  if (n.customer?.name) return n.customer.name;
  if (n.documentId) return `document ${n.documentId}`;
  return null;
}

export async function listNotifications(
  client: LinearClient,
  limit: number,
  includeArchived: boolean,
): Promise<NotificationRow[]> {
  return collectRawQuery<NotificationRow>(
    client as any,
    LIST_QUERY,
    { includeArchived },
    "notifications",
    limit,
    (n) => ({
      id: n.id,
      type: n.type ?? n.__typename ?? "",
      subject: subjectOf(n),
      read: !!n.readAt,
      readAt: n.readAt ?? null,
      snoozedUntilAt: n.snoozedUntilAt ?? null,
      archivedAt: n.archivedAt ?? null,
      createdAt: n.createdAt,
    }),
  );
}

/**
 * Mark a single notification read (now) or unread (null).
 *
 * NotificationPayload exposes only {success,lastSyncId} (no notification body),
 * so there is no entity to unwrap — `assertMutation` is the whole check, and a
 * refused write throws instead of being handed back as `{success:false}` for a
 * caller to ignore.
 */
export async function setRead(client: LinearClient, id: string, read: boolean) {
  const input = { readAt: read ? new Date().toISOString() : null };
  await assertMutation(
    withRetry(() => client.updateNotification(id, input as any)),
    read ? "Marking notification read" : "Marking notification unread",
  );
  return { id, read };
}

/** One notification's outcome within `markAllRead`. */
export interface MarkAllItem {
  id: string;
  read: boolean;
  error?: string;
}

export const MARK_ALL_ITEM_SHAPE = shape<MarkAllItem>({
  id: "string",
  read: "boolean",
  "error?": "string",
});

/**
 * Mark all of the viewer's unread notifications as read. The SDK's
 * `notificationMarkReadAll` requires a specific entity type (an empty input is
 * rejected with "entity type is not supported"), so we instead enumerate unread
 * notifications and mark each read.
 *
 * This is a batch of independent mutations, so it reports what actually
 * happened per item rather than a hardcoded aggregate: `count` is the number
 * that really went through, and `failed` carries the ones that did not, with the
 * API's reason. One bad notification does not abort the rest — but it can no
 * longer be reported as a success.
 */
export async function markAllRead(
  client: LinearClient,
): Promise<{ success: boolean; count: number; attempted: number; failed: MarkAllItem[] }> {
  const rows = await listNotifications(client, Infinity, false);
  const unread = rows.filter((r) => !r.readAt);
  const readAt = new Date().toISOString();
  const failed: MarkAllItem[] = [];
  let count = 0;
  for (const r of unread) {
    try {
      await assertMutation(
        withRetry(() => client.updateNotification(r.id, { readAt } as any)),
        "Marking notification read",
      );
      count += 1;
    } catch (err) {
      failed.push({ id: r.id, read: false, error: normalizeError(err).message });
    }
  }
  return { success: failed.length === 0, count, attempted: unread.length, failed };
}

export async function archiveNotification(client: LinearClient, id: string): Promise<boolean> {
  await assertMutation(
    withRetry(() => client.archiveNotification(id)),
    "Notification archive",
  );
  return true;
}

/** Snooze a notification until the given ISO timestamp. */
export async function snoozeNotification(client: LinearClient, id: string, untilISO: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      untilISO,
    ) ||
    !Number.isFinite(Date.parse(untilISO))
  ) {
    throw usageError(
      `Invalid snooze timestamp '${untilISO}'. Use ISO 8601 with a timezone, e.g. 2026-07-01T09:00:00Z.`,
    );
  }
  await assertMutation(
    withRetry(() => client.updateNotification(id, { snoozedUntilAt: untilISO } as any)),
    "Notification snooze",
  );
  return { id, snoozedUntilAt: untilISO };
}
