/**
 * Issue service: all SDK access for issues lives here so commands stay thin.
 *
 * Lists use a tailored GraphQL query (one round-trip, no N+1 on state/assignee);
 * single `view` and all mutations use the typed SDK models.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { collect } from "../lib/pagination.js";
import { usageError, notFound } from "../lib/errors.js";
import {
  resolveUserId,
  resolveProjectId,
  resolveCycleId,
  resolveStateId,
  resolveLabelIds,
  resolveMilestoneId,
  resolveTeam,
  resolveIssue,
  firstStateOfType,
  isUuid,
  STATE_TYPES,
} from "../lib/resolve.js";

export interface IssueRow {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  priorityLabel: string;
  estimate: number | null;
  url: string;
  updatedAt: string;
  state: { name: string; type: string } | null;
  assignee: { displayName: string } | null;
  project: { name: string } | null;
  labels: string[];
}

export interface ListFilters {
  team?: string;
  assignee?: string;
  state?: string;
  project?: string;
  label?: string[];
  priority?: string;
  cycle?: string;
  query?: string;
  sort?: string;
  includeArchived?: boolean;
}

const LIST_QUERY = `
query CliIssues($filter: IssueFilter, $first: Int!, $after: String, $sort: [IssueSortInput!], $includeArchived: Boolean) {
  issues(filter: $filter, first: $first, after: $after, sort: $sort, includeArchived: $includeArchived) {
    nodes {
      id identifier title priority priorityLabel estimate url updatedAt
      state { name type }
      assignee { displayName }
      project { name }
      labels(first: 20) { nodes { name } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Build an IssueFilter from human options, resolving names to ids. Exported for tests. */
export async function buildFilter(
  client: LinearClient,
  f: ListFilters,
  defaultTeamKey: string | undefined,
): Promise<Record<string, unknown>> {
  const filter: Record<string, any> = {};
  const teamKey = f.team ?? defaultTeamKey;
  if (teamKey) filter.team = { key: { eq: teamKey.toUpperCase() } };

  if (f.assignee) {
    const userId = await resolveUserId(client, f.assignee);
    filter.assignee = { id: { eq: userId } };
  }
  if (f.state) {
    const lower = f.state.toLowerCase();
    filter.state = STATE_TYPES.includes(lower)
      ? { type: { eq: lower } }
      : { name: { eqIgnoreCase: f.state } };
  }
  if (f.project) {
    const projectId = await resolveProjectId(client, f.project);
    filter.project = { id: { eq: projectId } };
  }
  if (f.label && f.label.length) {
    filter.labels = { some: { name: { in: f.label } } };
  }
  if (f.priority !== undefined) {
    filter.priority = { eq: Number.parseInt(f.priority, 10) };
  }
  if (f.cycle) {
    // A UUID can filter directly; a number/name needs a team to resolve against.
    if (isUuid(f.cycle)) {
      filter.cycle = { id: { eq: f.cycle } };
    } else if (teamKey) {
      const teamForCycle = (await resolveTeam(client, teamKey, undefined)).id;
      filter.cycle = { id: { eq: await resolveCycleId(client, teamForCycle, f.cycle) } };
    } else {
      throw usageError("Filtering by a cycle number/name requires --team (or pass a cycle id).");
    }
  }
  if (f.query) {
    filter.searchableContent = { contains: f.query };
  }
  return filter;
}

/** Server-side sort spec (correct under pagination — no client-side resort). Exported for tests. */
export function sortSpec(sort: string | undefined): Array<Record<string, unknown>> {
  switch (sort) {
    case "priority":
      // Linear sorts priority by urgency; Descending → Urgent…Low, None last.
      return [{ priority: { order: "Descending", noPriorityFirst: false } }];
    case "created":
      return [{ createdAt: { order: "Descending" } }];
    case "updated":
    default:
      return [{ updatedAt: { order: "Descending" } }];
  }
}

export async function listIssues(
  client: LinearClient,
  filters: ListFilters,
  limit: number,
  defaultTeamKey: string | undefined,
): Promise<IssueRow[]> {
  const filter = await buildFilter(client, filters, defaultTeamKey);
  const pageLimit = limit === Infinity ? 100 : Math.min(limit, 100);
  const rows: IssueRow[] = [];
  let after: string | undefined;

  for (;;) {
    const data: any = await withRetry(() =>
      (client.client as any).rawRequest(LIST_QUERY, {
        filter,
        first: pageLimit,
        after,
        sort: sortSpec(filters.sort),
        includeArchived: !!filters.includeArchived,
      }),
    );
    const conn = data.data.issues;
    for (const n of conn.nodes) {
      rows.push({
        id: n.id,
        identifier: n.identifier,
        title: n.title,
        priority: n.priority,
        priorityLabel: n.priorityLabel,
        estimate: n.estimate ?? null,
        url: n.url,
        updatedAt: n.updatedAt,
        state: n.state ?? null,
        assignee: n.assignee ?? null,
        project: n.project ?? null,
        labels: (n.labels?.nodes ?? []).map((l: any) => l.name),
      });
      if (rows.length >= limit) break;
    }
    if (rows.length >= limit || !conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  // Sorting is done server-side (see sortSpec), so it is correct across pages.
  return rows;
}

/** Free-text search via the dedicated searchIssues connection. */
export async function searchIssues(
  client: LinearClient,
  term: string,
  limit: number,
): Promise<IssueRow[]> {
  const conn: any = await withRetry(() => (client as any).searchIssues(term, { first: Math.min(limit, 100) }));
  const nodes = await collect(conn, limit);
  // searchIssues returns full Issue models; resolve the display fields we show.
  return Promise.all(
    nodes.map(async (issue: any) => {
      const [state, assignee, project] = await Promise.all([issue.state, issue.assignee, issue.project]);
      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        priority: issue.priority,
        priorityLabel: issue.priorityLabel,
        estimate: issue.estimate ?? null,
        url: issue.url,
        updatedAt: issue.updatedAt?.toISOString?.() ?? String(issue.updatedAt),
        state: state ? { name: state.name, type: state.type } : null,
        assignee: assignee ? { displayName: assignee.displayName } : null,
        project: project ? { name: project.name } : null,
        labels: [],
      } as IssueRow;
    }),
  );
}

export interface IssueDetail {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  priorityLabel: string;
  estimate: number | null;
  url: string;
  branchName: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  state: string | null;
  assignee: string | null;
  team: string | null;
  project: string | null;
  milestone: string | null;
  cycle: string | null;
  parent: string | null;
  labels: string[];
  subscribers: string[];
}

export async function getIssueDetail(client: LinearClient, idArg: string): Promise<IssueDetail> {
  const issue = await resolveIssue(client, idArg);
  const [state, assignee, team, project, milestone, cycle, parent, labels, subscribers] =
    await Promise.all([
      issue.state,
      issue.assignee,
      issue.team,
      issue.project,
      issue.projectMilestone,
      issue.cycle,
      issue.parent,
      issue.labels(),
      issue.subscribers(),
    ]);
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    estimate: issue.estimate ?? null,
    url: issue.url,
    branchName: issue.branchName,
    dueDate: issue.dueDate ?? null,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    state: state?.name ?? null,
    assignee: assignee?.displayName ?? null,
    team: team ? `${team.key} ${team.name}` : null,
    project: project?.name ?? null,
    milestone: milestone?.name ?? null,
    cycle: cycle ? `#${cycle.number}${cycle.name ? ` ${cycle.name}` : ""}` : null,
    parent: parent?.identifier ?? null,
    labels: labels.nodes.map((l) => l.name),
    subscribers: subscribers.nodes.map((s) => s.displayName),
  };
}

export interface CreateOptions {
  title: string;
  description?: string;
  team?: string;
  assignee?: string;
  state?: string;
  priority?: number;
  label?: string[];
  project?: string;
  milestone?: string;
  cycle?: string;
  estimate?: number;
  parent?: string;
  dueDate?: string;
}

/** Build an IssueCreateInput, resolving every human reference to an id. */
export async function createIssue(
  client: LinearClient,
  opts: CreateOptions,
  defaultTeamKey: string | undefined,
) {
  const team = await resolveTeam(client, opts.team, defaultTeamKey);
  const input: Record<string, any> = { teamId: team.id, title: opts.title };
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.priority !== undefined) input.priority = opts.priority;
  if (opts.estimate !== undefined) input.estimate = opts.estimate;
  if (opts.dueDate) input.dueDate = opts.dueDate;
  if (opts.assignee) input.assigneeId = await resolveUserId(client, opts.assignee);
  if (opts.state) input.stateId = await resolveStateId(client, team.id, opts.state);
  if (opts.label?.length) input.labelIds = await resolveLabelIds(client, opts.label, team.id);
  if (opts.project) input.projectId = await resolveProjectId(client, opts.project);
  if (opts.milestone) {
    const projectId = input.projectId ?? (opts.project ? await resolveProjectId(client, opts.project) : undefined);
    if (!projectId) throw usageError("A milestone requires --project.");
    input.projectMilestoneId = await resolveMilestoneId(client, projectId, opts.milestone);
  }
  if (opts.cycle) input.cycleId = await resolveCycleId(client, team.id, opts.cycle);
  if (opts.parent) input.parentId = (await resolveIssue(client, opts.parent)).id;

  const payload = await withRetry(() => client.createIssue(input as any));
  const issue = await payload.issue;
  if (!issue) throw usageError("Issue creation returned no issue.");
  return issue;
}

export interface UpdateOptions {
  title?: string;
  description?: string;
  assignee?: string;
  state?: string;
  priority?: number;
  project?: string;
  milestone?: string;
  cycle?: string;
  estimate?: number;
  parent?: string;
  dueDate?: string;
  addLabel?: string[];
  removeLabel?: string[];
}

export async function updateIssue(client: LinearClient, idArg: string, opts: UpdateOptions) {
  const issue = await resolveIssue(client, idArg);
  const teamId = (await issue.team)?.id;
  const input: Record<string, any> = {};
  if (opts.title !== undefined) input.title = opts.title;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.priority !== undefined) input.priority = opts.priority;
  if (opts.estimate !== undefined) input.estimate = opts.estimate;
  if (opts.dueDate !== undefined) input.dueDate = opts.dueDate;
  if (opts.assignee) input.assigneeId = await resolveUserId(client, opts.assignee);
  if (opts.state) {
    if (!teamId) throw usageError("Cannot resolve state without a team.");
    input.stateId = await resolveStateId(client, teamId, opts.state);
  }
  if (opts.project) input.projectId = await resolveProjectId(client, opts.project);
  if (opts.cycle && teamId) input.cycleId = await resolveCycleId(client, teamId, opts.cycle);
  if (opts.parent) input.parentId = (await resolveIssue(client, opts.parent)).id;
  if (opts.addLabel?.length) input.addedLabelIds = await resolveLabelIds(client, opts.addLabel, teamId);
  if (opts.removeLabel?.length)
    input.removedLabelIds = await resolveLabelIds(client, opts.removeLabel, teamId);
  if (opts.milestone) {
    const projectId = input.projectId ?? (await issue.project)?.id;
    if (!projectId)
      throw usageError("A milestone requires the issue to be in a project (or pass --project).");
    input.projectMilestoneId = await resolveMilestoneId(client, projectId, opts.milestone);
  }

  if (Object.keys(input).length === 0) throw usageError("Nothing to update; pass at least one field.");
  const payload = await withRetry(() => client.updateIssue(issue.id, input as any));
  return (await payload.issue) ?? issue;
}

export async function archiveIssue(client: LinearClient, idArg: string, unarchive: boolean) {
  const issue = await resolveIssue(client, idArg);
  await withRetry(() => (unarchive ? client.unarchiveIssue(issue.id) : client.archiveIssue(issue.id)));
  return issue;
}

export async function deleteIssue(client: LinearClient, idArg: string) {
  const issue = await resolveIssue(client, idArg);
  await withRetry(() => client.deleteIssue(issue.id));
  return issue;
}

export async function setSubscription(client: LinearClient, idArg: string, subscribe: boolean) {
  const issue = await resolveIssue(client, idArg);
  await withRetry(() =>
    subscribe ? client.issueSubscribe(issue.id) : client.issueUnsubscribe(issue.id),
  );
  return issue;
}

export async function commentOnIssue(client: LinearClient, idArg: string, body: string) {
  const issue = await resolveIssue(client, idArg);
  const payload = await withRetry(() => client.createComment({ issueId: issue.id, body }));
  return { issue, comment: await payload.comment };
}

export async function listComments(client: LinearClient, idArg: string, limit: number) {
  const issue = await resolveIssue(client, idArg);
  const conn = await withRetry(() => issue.comments({ first: limit === Infinity ? 100 : limit }));
  const nodes = await collect(conn as any, limit);
  return Promise.all(
    nodes.map(async (c: any) => {
      const user = await c.user;
      return {
        id: c.id,
        body: c.body,
        user: user?.displayName ?? "unknown",
        createdAt: c.createdAt?.toISOString?.() ?? String(c.createdAt),
      };
    }),
  );
}

/**
 * Move an issue's state for `start`. `move` (--move) selects the team's first
 * `started`-type state; an explicit `stateInput` is resolved by name/type.
 */
export async function startIssue(
  client: LinearClient,
  idArg: string,
  opts: { stateInput?: string; move?: boolean },
) {
  const issue = await resolveIssue(client, idArg);
  if (opts.stateInput || opts.move) {
    const teamId = (await issue.team)?.id;
    if (!teamId) throw usageError("Cannot resolve team for state change.");
    const stateId = opts.stateInput
      ? await resolveStateId(client, teamId, opts.stateInput)
      : await firstStateOfType(client, teamId, "started");
    await withRetry(() => client.updateIssue(issue.id, { stateId }));
  }
  return issue;
}

export async function addRemoveRelation(
  client: LinearClient,
  idArg: string,
  op: "add" | "remove",
  type: "blocks" | "blocked_by" | "related" | "duplicate",
  otherArg: string,
) {
  const issue = await resolveIssue(client, idArg);
  const other = await resolveIssue(client, otherArg);
  // "blocked_by" is modeled as the inverse "blocks" from the other issue.
  const apiType = type === "blocked_by" ? "blocks" : type;
  const [from, to] = type === "blocked_by" ? [other, issue] : [issue, other];
  if (op === "add") {
    await withRetry(() => client.createIssueRelation({ issueId: from.id, relatedIssueId: to.id, type: apiType as any }));
  } else {
    // The single relation record may live on either issue (direction matters for
    // blocks/blocked_by). Search `from`'s direct + inverse relations for a record
    // of `apiType` whose source=from and target=to.
    const [direct, inverse] = await Promise.all([
      collect((await withRetry(() => from.relations())) as any, Infinity),
      collect((await withRetry(() => from.inverseRelations())) as any, Infinity),
    ]);
    const match = await findRelation([...direct, ...inverse] as any[], from.id, to.id, apiType);
    if (!match) throw notFound(`No ${type} relation between ${issue.identifier} and ${other.identifier}.`);
    await withRetry(() => client.deleteIssueRelation(match.id));
  }
  return { issue, other };
}

/** Find the relation record of `type` whose endpoints are exactly {sourceId, targetId}. */
async function findRelation(nodes: any[], sourceId: string, targetId: string, type: string) {
  for (const r of nodes) {
    if (r.type !== type) continue;
    const [src, tgt] = await Promise.all([r.issue, r.relatedIssue]);
    const a = src?.id;
    const b = tgt?.id;
    // For directional `blocks`, require source→target order; symmetric types
    // (related/duplicate) match either orientation.
    if (type === "blocks") {
      if (a === sourceId && b === targetId) return r;
    } else if ((a === sourceId && b === targetId) || (a === targetId && b === sourceId)) {
      return r;
    }
  }
  return undefined;
}

const INVERSE_TYPE: Record<string, string> = {
  blocks: "blocked_by",
  related: "related",
  duplicate: "duplicate",
  similar: "similar",
};

export async function listRelations(client: LinearClient, idArg: string) {
  const issue = await resolveIssue(client, idArg);
  // Direct relations (this issue is the source) + inverse relations (this issue
  // is the target — e.g. a "blocks" on another issue means we're "blocked_by").
  // Both are paginated to completion.
  const [direct, inverse] = await Promise.all([
    collect((await withRetry(() => issue.relations())) as any, Infinity),
    collect((await withRetry(() => issue.inverseRelations())) as any, Infinity),
  ]);
  const out = await Promise.all([
    ...direct.map(async (r: any) => {
      const related = await r.relatedIssue;
      return { type: r.type, issue: related?.identifier ?? "?", title: related?.title ?? "" };
    }),
    ...inverse.map(async (r: any) => {
      const source = await r.issue;
      return {
        type: INVERSE_TYPE[r.type] ?? r.type,
        issue: source?.identifier ?? "?",
        title: source?.title ?? "",
      };
    }),
  ]);
  return out;
}
