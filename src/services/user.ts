/**
 * User service: all SDK access for users lives here so commands stay thin.
 *
 * The workspace user list goes through the typed `client.users()` connection;
 * single `view`/`me` resolve a user id via `resolveUserId` (handling me / email /
 * name / id) and read the typed SDK model. This group is read-only.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { collect, pageSize } from "../lib/pagination.js";
import { resolveUserId } from "../lib/resolve.js";

export interface UserRow {
  id: string;
  displayName: string;
  name: string;
  email: string;
  active: boolean;
  admin: boolean;
  guest: boolean;
}

/**
 * List the workspace's users. Linear defaults `includeDisabled` to false, so
 * deactivated users are invisible (and the `active` column constantly true)
 * unless the caller opts in.
 */
export async function listUsers(
  client: LinearClient,
  limit: number,
  includeDisabled = false,
): Promise<UserRow[]> {
  const conn = await withRetry(() => client.users({ first: pageSize(limit), includeDisabled }));
  const nodes = await collect(conn as any, limit);
  return nodes.map(toRow);
}

export interface UserDetail {
  id: string;
  displayName: string;
  name: string;
  email: string;
  active: boolean;
  admin: boolean;
  guest: boolean;
  isMe: boolean;
  description: string | null;
  statusLabel: string | null;
  timezone: string | null;
  url: string;
  avatarUrl: string | null;
  lastSeen: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Resolve a user reference (`me`, email, name, or id) and return its detail.
 * `resolveUserId` handles the `me`/email/name/id ergonomics.
 */
export async function getUserDetail(client: LinearClient, idArg: string): Promise<UserDetail> {
  const userId = await resolveUserId(client, idArg);
  const user = await withRetry(() => client.user(userId));
  return toDetail(user);
}

/** The authenticated viewer. */
export async function getViewer(client: LinearClient): Promise<UserDetail> {
  const user = await withRetry(() => client.viewer);
  return toDetail(user);
}

function toRow(u: any): UserRow {
  return {
    id: u.id,
    displayName: u.displayName,
    name: u.name,
    email: u.email,
    active: !!u.active,
    admin: !!u.admin,
    guest: !!u.guest,
  };
}

function toDetail(u: any): UserDetail {
  return {
    id: u.id,
    displayName: u.displayName,
    name: u.name,
    email: u.email,
    active: !!u.active,
    admin: !!u.admin,
    guest: !!u.guest,
    isMe: !!u.isMe,
    description: u.description ?? null,
    statusLabel: u.statusLabel ?? null,
    timezone: u.timezone ?? null,
    url: u.url,
    avatarUrl: u.avatarUrl ?? null,
    lastSeen: u.lastSeen?.toISOString?.() ?? (u.lastSeen ? String(u.lastSeen) : null),
    createdAt: u.createdAt?.toISOString?.() ?? String(u.createdAt),
    updatedAt: u.updatedAt?.toISOString?.() ?? String(u.updatedAt),
  };
}
