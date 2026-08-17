/**
 * Organization service: all SDK access for the workspace lives here so commands
 * stay thin. This is a read-only group — workspace `view`, member listing, and
 * pending-invite listing. Admin/destructive operations are intentionally out of
 * scope.
 *
 * The single `view` uses the typed `client.organization` getter; members and
 * invites use the typed SDK connections and paginate via `collect()`.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { shape } from "../lib/shape.js";
import { collect } from "../lib/pagination.js";
import { pageSize } from "../lib/pagination.js";

export interface OrganizationDetail {
  id: string;
  name: string;
  urlKey: string;
  userCount: number;
  createdIssueCount: number;
  samlEnabled: boolean;
  scimEnabled: boolean;
  roadmapEnabled: boolean;
  logoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The detail's shape as `linear commands` advertises it (TES-610); checked against the interface. */
export const ORGANIZATION_DETAIL_SHAPE = shape<OrganizationDetail>({
  id: "string",
  name: "string",
  urlKey: "string",
  userCount: "number",
  createdIssueCount: "number",
  samlEnabled: "boolean",
  scimEnabled: "boolean",
  roadmapEnabled: "boolean",
  logoUrl: "string|null",
  createdAt: "string",
  updatedAt: "string",
});

export async function getOrganizationDetail(client: LinearClient): Promise<OrganizationDetail> {
  // `client.organization` is a getter that returns a LinearFetch<Organization>.
  const org = await withRetry(() => client.organization);
  return {
    id: org.id,
    name: org.name,
    urlKey: org.urlKey,
    userCount: org.userCount,
    createdIssueCount: org.createdIssueCount,
    samlEnabled: !!org.samlEnabled,
    scimEnabled: !!org.scimEnabled,
    roadmapEnabled: !!org.roadmapEnabled,
    logoUrl: org.logoUrl ?? null,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  };
}

export interface MemberRow {
  id: string;
  displayName: string;
  name: string;
  email: string;
  admin: boolean;
  active: boolean;
}

export const ORGANIZATION_MEMBER_ROW_SHAPE = shape<MemberRow>({
  id: "string",
  displayName: "string",
  name: "string",
  email: "string",
  admin: "boolean",
  active: "boolean",
});

/** List workspace users (members). Paginates to the requested limit. */
export async function listMembers(client: LinearClient, limit: number): Promise<MemberRow[]> {
  const conn = await withRetry(() => client.users({ first: pageSize(limit) }));
  const nodes = await collect(conn as any, limit);
  return nodes.map((u: any) => ({
    id: u.id,
    displayName: u.displayName,
    name: u.name,
    email: u.email,
    admin: !!u.admin,
    active: !!u.active,
  }));
}

export interface InviteRow {
  id: string;
  email: string;
  status: string;
  role: string;
  external: boolean;
  createdAt: string;
}

export const INVITE_ROW_SHAPE = shape<InviteRow>({
  id: "string",
  email: "string",
  status: "string",
  role: "string",
  external: "boolean",
  createdAt: "string",
});

/**
 * Derive a human status for an invite. The `OrganizationInvite` model exposes
 * `acceptedAt`/`expiresAt` rather than a status enum, so we classify from those:
 * accepted > expired > pending.
 */
export function inviteStatus(invite: { acceptedAt?: unknown; expiresAt?: unknown }): string {
  if (invite.acceptedAt) return "accepted";
  if (invite.expiresAt && new Date(invite.expiresAt as any).getTime() < Date.now()) {
    return "expired";
  }
  return "pending";
}

/** List organization invites. Tolerates an empty list (returns `[]`). */
export async function listInvites(client: LinearClient, limit: number): Promise<InviteRow[]> {
  const conn = await withRetry(() => client.organizationInvites({ first: pageSize(limit) }));
  const nodes = await collect(conn as any, limit);
  return nodes.map((i: any) => ({
    id: i.id,
    email: i.email,
    status: inviteStatus(i),
    role: i.role ?? "member",
    external: !!i.external,
    createdAt: i.createdAt?.toISOString?.() ?? String(i.createdAt),
  }));
}
