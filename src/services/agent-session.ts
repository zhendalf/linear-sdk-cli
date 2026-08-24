/**
 * Agent-session service: the sessions Linear's agent integrations (Codex,
 * Claude, Cursor, …) open on an issue when they are mentioned or delegated to.
 *
 * Both listings and the single `view` use tailored GraphQL queries: one
 * selection set for the row, so a session looks the same whether it was found
 * through its issue or through the workspace-wide feed, and one round-trip for
 * the detail (the SDK-model path fetches the agent, the creator, the issue and
 * the activities as four more requests). Every field selected is public schema
 * — the SDK's own `AgentSession` model carries the same ones — so this does not
 * depend on the `[Internal]` `Issue.agentSessions` connection.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { shape } from "../lib/shape.js";
import { collectRawQuery, hasMoreResults, setPaginationMetadata } from "../lib/pagination.js";
import { notFound } from "../lib/errors.js";

/** The statuses Linear reports for a session (AgentSessionStatus). */
export const AGENT_SESSION_STATUSES = [
  "pending",
  "active",
  "awaitingInput",
  "complete",
  "error",
  "stale",
] as const;
export type AgentSessionStatus = (typeof AGENT_SESSION_STATUSES)[number];

/** A user as the session references it: the agent (`appUser`) or a human. */
export interface SessionUser {
  id: string;
  name: string;
  displayName: string;
}

const SESSION_USER_SHAPE = shape<SessionUser>({
  id: "string",
  name: "string",
  displayName: "string",
});

export interface AgentSessionRow {
  id: string;
  status: string;
  /** Deprecated upstream (always `commentThread` today); kept because the API still returns it. */
  type: string | null;
  summary: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  url: string | null;
  issue: { id: string; identifier: string; title: string } | null;
  /** The agent user the session belongs to (the API's `appUser`). */
  agent: SessionUser | null;
  /** The human who started the session; null when an automation or another agent did. */
  creator: SessionUser | null;
}

/** The row's shape as `linear commands` advertises it (TES-610); checked against the interface. */
export const AGENT_SESSION_ROW_SHAPE = shape<AgentSessionRow>({
  id: "string",
  status: "string",
  type: "string|null",
  summary: "string|null",
  createdAt: "string",
  startedAt: "string|null",
  endedAt: "string|null",
  url: "string|null",
  issue: { nullable: { id: "string", identifier: "string", title: "string" } },
  agent: { nullable: SESSION_USER_SHAPE },
  creator: { nullable: SESSION_USER_SHAPE },
});

const ROW_FIELDS = `
  id status type summary createdAt startedAt endedAt url
  issue { id identifier title }
  appUser { id name displayName }
  creator { id name displayName }
`;

/**
 * An issue's sessions, read off its comments: every session is anchored to a
 * comment thread on the issue (`Comment.agentSession`), and that edge is public
 * where `Issue.agentSessions` is not. Comments are paged to exhaustion —
 * sessions are sparse among them, so a limit on comments would not be a limit
 * on sessions — and the caller's limit is applied to the sessions found.
 */
const ISSUE_QUERY = `
query CliIssueAgentSessions($id: String!, $first: Int!, $after: String) {
  issue(id: $id) {
    comments(first: $first, after: $after) {
      nodes { agentSession { ${ROW_FIELDS} } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/** The workspace-wide feed, newest first — the SDK's `agentSessions`. */
const ALL_QUERY = `
query CliAgentSessions($first: Int!, $after: String) {
  agentSessions(first: $first, after: $after) {
    nodes { ${ROW_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

export interface ListOptions {
  /** Keep only sessions in this status (validated by the command's `.choices`). */
  status?: string;
}

/** Sessions on one issue (identifier or id), newest first. */
export async function listIssueAgentSessions(
  client: LinearClient,
  issueId: string,
  limit: number,
  opts: ListOptions = {},
): Promise<AgentSessionRow[]> {
  const sessions = await collectRawQuery<AgentSessionRow | null>(
    client as any,
    ISSUE_QUERY,
    { id: issueId },
    "issue.comments",
    Infinity,
    (n) => (n.agentSession ? toRow(n.agentSession) : null),
  );
  return finish(sessions, limit, opts);
}

/** Every session in the workspace, newest first. */
export async function listAllAgentSessions(
  client: LinearClient,
  limit: number,
  opts: ListOptions = {},
): Promise<AgentSessionRow[]> {
  // The status filter is applied after the fetch (the API has no filter
  // argument on this connection), so the page has to be exhaustive when one is
  // set — a limit on the unfiltered feed would hide matches.
  const rows = await collectRawQuery<AgentSessionRow>(
    client as any,
    ALL_QUERY,
    {},
    "agentSessions",
    opts.status ? Infinity : limit,
    toRow,
  );
  return finish(rows, limit, opts);
}

function finish(
  rows: Array<AgentSessionRow | null>,
  limit: number,
  opts: ListOptions,
): AgentSessionRow[] {
  const present = rows.filter((r): r is AgentSessionRow => r !== null);
  const filtered = opts.status ? present.filter((r) => r.status === opts.status) : present;
  // Newest first, whichever query found them (an issue's comments come oldest first).
  filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  if (limit === Infinity) return setPaginationMetadata(filtered, false);
  return setPaginationMetadata(
    filtered.slice(0, limit),
    filtered.length > limit || (!opts.status && filtered.length >= limit && hasMoreResults(rows)),
  );
}

function toRow(s: any): AgentSessionRow {
  return {
    id: s.id,
    status: s.status,
    type: s.type ?? null,
    summary: s.summary ?? null,
    createdAt: s.createdAt,
    startedAt: s.startedAt ?? null,
    endedAt: s.endedAt ?? null,
    url: s.url ?? null,
    issue: s.issue ?? null,
    agent: s.appUser ?? null,
    creator: s.creator ?? null,
  };
}

/** One step of the agent's work, flattened from the activity-content union. */
export interface AgentActivityRow {
  id: string;
  createdAt: string;
  /** thought | action | response | prompt | error | elicitation */
  type: string;
  /** The text of a thought/response/prompt/error/elicitation; null for an action. */
  body: string | null;
  /** An action's name (`Running command`) and its parameter/result; null otherwise. */
  action: string | null;
  parameter: string | null;
  result: string | null;
}

export const AGENT_ACTIVITY_ROW_SHAPE = shape<AgentActivityRow>({
  id: "string",
  createdAt: "string",
  type: "string",
  body: "string|null",
  action: "string|null",
  parameter: "string|null",
  result: "string|null",
});

export interface AgentSessionDetail extends AgentSessionRow {
  updatedAt: string;
  dismissedAt: string | null;
  dismissedBy: SessionUser | null;
  externalLink: string | null;
  /** Oldest first, up to `ACTIVITY_LIMIT`; `activitiesTruncated` says whether more exist. */
  activities: AgentActivityRow[];
  activitiesTruncated: boolean;
}

/** The detail's shape; checked against `AgentSessionDetail` (the row, plus the transcript). */
export const AGENT_SESSION_DETAIL_SHAPE = shape<AgentSessionDetail>({
  ...AGENT_SESSION_ROW_SHAPE,
  updatedAt: "string",
  dismissedAt: "string|null",
  dismissedBy: { nullable: SESSION_USER_SHAPE },
  externalLink: "string|null",
  activities: [AGENT_ACTIVITY_ROW_SHAPE],
  activitiesTruncated: "boolean",
});

/** How many activities `view` fetches — a session is short, and the API prices nested lists by their worst case. */
const ACTIVITY_LIMIT = 100;

const DETAIL_QUERY = `
query CliAgentSessionDetail($id: String!, $activities: Int!) {
  agentSession(id: $id) {
    ${ROW_FIELDS}
    updatedAt dismissedAt externalLink
    dismissedBy { id name displayName }
    activities(first: $activities) {
      nodes {
        id createdAt
        content {
          __typename
          ... on AgentActivityThoughtContent { type body }
          ... on AgentActivityActionContent { type action parameter result }
          ... on AgentActivityResponseContent { type body }
          ... on AgentActivityPromptContent { type body }
          ... on AgentActivityErrorContent { type body }
          ... on AgentActivityElicitationContent { type body }
        }
      }
      pageInfo { hasNextPage }
    }
  }
}`;

export async function getAgentSessionDetail(
  client: LinearClient,
  id: string,
): Promise<AgentSessionDetail> {
  const data: any = await withRetry(() =>
    (client as any).client.rawRequest(DETAIL_QUERY, { id, activities: ACTIVITY_LIMIT }),
  );
  const s = data.data?.agentSession;
  if (!s) throw notFound(`No agent session '${id}'.`);
  const activities: any[] = s.activities?.nodes ?? [];
  return {
    ...toRow(s),
    updatedAt: s.updatedAt,
    dismissedAt: s.dismissedAt ?? null,
    dismissedBy: s.dismissedBy ?? null,
    externalLink: s.externalLink ?? null,
    // The API serves activities newest first; a transcript reads the other way.
    activities: activities.map(toActivity).reverse(),
    activitiesTruncated: s.activities?.pageInfo?.hasNextPage === true,
  };
}

function toActivity(a: any): AgentActivityRow {
  const c = a.content ?? {};
  return {
    id: a.id,
    createdAt: a.createdAt,
    type: c.type ?? "unknown",
    body: c.body ?? null,
    action: c.action ?? null,
    parameter: c.parameter ?? null,
    result: c.result ?? null,
  };
}
