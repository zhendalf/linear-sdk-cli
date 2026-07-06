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
import { collectRawQuery } from "../lib/pagination.js";

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
 * so we return the id we acted on alongside success.
 */
export async function setRead(client: LinearClient, id: string, read: boolean) {
  const input = { readAt: read ? new Date().toISOString() : null };
  const payload = await withRetry(() => client.updateNotification(id, input as any));
  return { id, success: payload.success };
}

/** Mark all of the viewer's notifications read via the batch mutation. */
/**
 * Mark all of the viewer's unread notifications as read. The SDK's
 * `notificationMarkReadAll` requires a specific entity type (an empty input is
 * rejected with "entity type is not supported"), so we instead enumerate unread
 * notifications and mark each read. Returns how many were updated.
 */
export async function markAllRead(client: LinearClient): Promise<{ success: boolean; count: number }> {
  const rows = await listNotifications(client, Infinity, false);
  const unread = rows.filter((r) => !r.readAt);
  const readAt = new Date().toISOString();
  for (const r of unread) {
    await withRetry(() => client.updateNotification(r.id, { readAt } as any));
  }
  return { success: true, count: unread.length };
}

export async function archiveNotification(client: LinearClient, id: string): Promise<boolean> {
  const payload = await withRetry(() => client.archiveNotification(id));
  return payload.success;
}

/** Snooze a notification until the given ISO timestamp. */
export async function snoozeNotification(client: LinearClient, id: string, untilISO: string) {
  const payload = await withRetry(() =>
    client.updateNotification(id, { snoozedUntilAt: untilISO } as any),
  );
  return { id, success: payload.success };
}
