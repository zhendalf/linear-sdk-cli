/**
 * Issue service: all SDK access for issues lives here so commands stay thin.
 *
 * Lists use a tailored GraphQL query (one round-trip, no N+1 on state/assignee);
 * single `view` and all mutations use the typed SDK models.
 */

import type { LinearClient, Issue } from "@linear/sdk";
import type { ResolvedConfig } from "../config.js";
import { withRetry } from "../client.js";
import { shape } from "../lib/shape.js";
import { collect, collectRawQuery } from "../lib/pagination.js";
import { CliError, usageError, notFound, ambiguous } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import {
  delegationFeatureError,
  isDelegationReadUnavailable,
  resolveDelegate,
  type DelegateRef,
} from "../lib/delegation.js";
import {
  resolveUserId,
  resolveProjectId,
  resolveCycleId,
  resolveStateId,
  resolveLabelIds,
  resolveMilestoneId,
  resolveTeam,
  resolveIssue,
  resolveTemplateId,
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
  /**
   * The same object shapes `IssueDetail` uses, so `.milestone.name` reads the
   * same on a list row and on `view`. They were missing here (TES-652): a
   * `--json | jq 'group_by(.milestone.name)'` put every issue in the null bucket.
   */
  milestone: { id: string; name: string } | null;
  cycle: { id: string; number: number; name: string | null } | null;
  labels: string[];
  /**
   * Lifecycle. `--include-archived` used to list archived and trashed issues
   * indistinguishably from live ones, and a deleted issue read back as alive.
   */
  archivedAt: string | null;
  trashed: boolean;
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
}

/**
 * The row's shape as `linear commands` advertises it (TES-610). `shape<IssueRow>`
 * is checked against the interface above, so the two cannot disagree.
 */
export const ISSUE_ROW_SHAPE = shape<IssueRow>({
  id: "string",
  identifier: "string",
  title: "string",
  priority: "number",
  priorityLabel: "string",
  estimate: "number|null",
  url: "string",
  updatedAt: "string",
  state: { nullable: { name: "string", type: "string" } },
  assignee: { nullable: { displayName: "string" } },
  project: { nullable: { name: "string" } },
  milestone: { nullable: { id: "string", name: "string" } },
  cycle: { nullable: { id: "string", number: "number", name: "string|null" } },
  labels: ["string"],
  archivedAt: "string|null",
  trashed: "boolean",
  startedAt: "string|null",
  completedAt: "string|null",
  canceledAt: "string|null",
});

/** The lifecycle fields every issue query selects, so row and detail agree. */
const LIFECYCLE_FIELDS = "archivedAt trashed startedAt completedAt canceledAt";

/**
 * The relations a list/search row selects — one string, so `LIST_QUERY` and
 * `SEARCH_QUERY` cannot drift apart (they did once: search hardcoded `labels: []`).
 */
const ROW_RELATIONS = `state { name type }
      assignee { displayName }
      project { name }
      projectMilestone { id name }
      cycle { id number name }
      labels(first: 20) { nodes { name } }`;

export interface ListFilters {
  /** One team key, or several (`--team` is repeatable on the issue queries). */
  team?: string | string[];
  /** Ignore the team flag and the configured default; search the whole workspace. */
  allTeams?: boolean;
  assignee?: string;
  /** Only issues with no assignee. Mutually exclusive with `assignee`. */
  unassigned?: boolean;
  /**
   * Workflow states, each a state *name* or a state *type*. Several broaden
   * (an issue is in exactly one state, so narrowing could never match). This is
   * also how `issue mine` applies its default: it passes `MINE_STATE_TYPES`
   * here when `--state` is absent, so there is one state path, not two.
   */
  state?: string[];
  project?: string;
  /** Issues whose *project* carries this label. Mutually exclusive with `project`. */
  projectLabel?: string;
  /** Project milestone by name or id; scoped to `project` when one is given. */
  milestone?: string;
  label?: string[];
  priority?: string;
  cycle?: string;
  /** Lower bound (inclusive) on createdAt — `YYYY-MM-DD` or full ISO 8601. */
  createdAfter?: string;
  /** Lower bound (inclusive) on updatedAt — `YYYY-MM-DD` or full ISO 8601. */
  updatedAfter?: string;
  query?: string;
  sort?: IssueSort;
  includeArchived?: boolean;
  /**
   * Search comment bodies too (`issue search` only — `searchIssues` takes this,
   * the plain `issues` query has nowhere to put it).
   */
  searchComments?: boolean;
}

/**
 * The workflow state types `issue mine` shows unless `--all-states` widens it.
 * Matches the reference CLI, whose `mine` defaults to unstarted work only — the
 * point of the command is "what should I pick up next", not "everything of mine".
 */
export const MINE_STATE_TYPES = ["unstarted"];

/** The sort orders `issue list` accepts, in `--sort`, env, and config alike. */
export const ISSUE_SORTS = ["priority", "manual", "updated", "created"] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];

type SortConfig = Pick<
  ResolvedConfig,
  "sort" | "sortSource" | "projectConfigPath" | "userConfigPath"
>;

/** Where a configured sort value came from, for the error message. */
function sortOrigin(config: SortConfig): string {
  switch (config.sortSource) {
    case "env":
      return "LINEAR_ISSUE_SORT";
    case "project":
      return `\`sort\` in ${config.projectConfigPath}`;
    case "user":
      return `\`sort\` in ${config.userConfigPath}`;
    default:
      return "config";
  }
}

/**
 * The single sort-resolution path: `--sort` > env/config > priority.
 *
 * `--sort` is validated by commander's choices, but the configured value is
 * not — an unrecognized `issue_sort`/`LINEAR_ISSUE_SORT` used to fall through
 * `sortSpec`'s default and silently sort by updatedAt instead of the documented
 * priority default. It is an error now, and it names where the value came from.
 */
export function resolveIssueSort(explicit: string | undefined, config: SortConfig): IssueSort {
  const value = explicit ?? config.sort;
  if (value === undefined) return "priority";
  if (!(ISSUE_SORTS as readonly string[]).includes(value)) {
    const where = explicit !== undefined ? "--sort" : sortOrigin(config);
    throw usageError(
      `Invalid sort '${value}' (${where}). Valid values: ${ISSUE_SORTS.join(", ")}.`,
    );
  }
  return value as IssueSort;
}

const LIST_QUERY = `
query CliIssues($filter: IssueFilter, $first: Int!, $after: String, $sort: [IssueSortInput!], $includeArchived: Boolean) {
  issues(filter: $filter, first: $first, after: $after, sort: $sort, includeArchived: $includeArchived) {
    nodes {
      id identifier title priority priorityLabel estimate url updatedAt ${LIFECYCLE_FIELDS}
      ${ROW_RELATIONS}
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Validate a date bound and normalize it to an ISO instant.
 *
 * `new Date()` accepts far too much ("1", "March 2024", "yesterday"), and a
 * garbage bound sent to the API comes back as an empty list rather than an
 * error — a filter that silently matches nothing. So the shape is checked here
 * first, and the flag that carried it is named in the message. Exported for tests.
 */
export function parseDateBound(value: string, flag: string): string {
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
  const parsed = ISO_DATE_RE.test(value) ? new Date(value) : new Date(NaN);
  if (Number.isNaN(parsed.getTime())) {
    throw usageError(
      `Invalid date for ${flag}: '${value}'. Use YYYY-MM-DD or ISO 8601 (e.g. 2026-01-15T09:00:00Z).`,
    );
  }
  return parsed.toISOString();
}

/** One `--state` value → its filter clause: a known type matches by type, anything else by name. */
function stateClause(value: string): Record<string, unknown> {
  const lower = value.toLowerCase();
  return STATE_TYPES.includes(lower) ? { type: { eq: lower } } : { name: { eqIgnoreCase: value } };
}

/** Normalize a single-or-repeated option to a deduplicated list. */
function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return [...new Set((Array.isArray(value) ? value : [value]).filter((v) => v.trim() !== ""))];
}

/** Build an IssueFilter from human options, resolving names to ids. Exported for tests. */
export async function buildFilter(
  client: LinearClient,
  f: ListFilters,
  defaultTeamKey: string | undefined,
): Promise<Record<string, unknown>> {
  const filter: Record<string, any> = {};
  // --all-teams wins over both the flag and the configured default.
  // Uppercase first, then dedupe: `--team tes --team TES` is one team.
  const teamKeys = [
    ...new Set(
      asList(f.allTeams ? undefined : (f.team ?? defaultTeamKey)).map((k) => k.toUpperCase()),
    ),
  ];
  // One team keeps the exact `eq` shape it has always sent; several use `in`
  // (the reference CLI spells the same thing as `or: [{ key: { eq } }, …]`).
  if (teamKeys.length === 1) filter.team = { key: { eq: teamKeys[0] } };
  else if (teamKeys.length > 1) filter.team = { key: { in: teamKeys } };

  if (f.unassigned && f.assignee) {
    throw usageError("Pass either --assignee or --unassigned, not both.");
  }
  if (f.unassigned) {
    filter.assignee = { null: true };
  } else if (f.assignee) {
    const userId = await resolveUserId(client, f.assignee);
    filter.assignee = { id: { eq: userId } };
  }
  const states = asList(f.state);
  if (states.length === 1) {
    filter.state = stateClause(states[0]!);
  } else if (states.length > 1) {
    // Several states OR together. Types collapse into one `in` (a fixed enum,
    // so no case-sensitivity trap); names stay separate `eqIgnoreCase` clauses,
    // because `in` is exact-case and `--state 'in progress'` must still match.
    const types = states.filter((s) => STATE_TYPES.includes(s.toLowerCase()));
    const names = states.filter((s) => !STATE_TYPES.includes(s.toLowerCase()));
    const clauses: Record<string, unknown>[] = [
      ...(types.length ? [{ type: { in: types.map((t) => t.toLowerCase()) } }] : []),
      ...names.map((name) => ({ name: { eqIgnoreCase: name } })),
    ];
    filter.state = clauses.length === 1 ? clauses[0]! : { or: clauses };
  }
  if (f.project && f.projectLabel) {
    throw usageError(
      "Pass either --project (one project) or --project-label (every project with that label), not both.",
    );
  }
  let projectId: string | undefined;
  if (f.project) {
    projectId = await resolveProjectId(client, f.project);
    filter.project = { id: { eq: projectId } };
  } else if (f.projectLabel) {
    // Project labels are workspace-level and matched by name, like `--label`:
    // `in`/`eq` are exact-case, so `--project-label mobile` would silently miss
    // a label stored as "Mobile".
    filter.project = { labels: { some: { name: { eqIgnoreCase: f.projectLabel } } } };
  }
  if (f.milestone) {
    // Milestone *names* are only unique within a project, so with --project we
    // resolve to an id. Without one, IssueFilter can still match by name across
    // projects — the SDK does not require the scoping the reference CLI demands,
    // so we accept the wider query instead of rejecting it.
    filter.projectMilestone = isUuid(f.milestone)
      ? { id: { eq: f.milestone } }
      : projectId
        ? { id: { eq: await resolveMilestoneId(client, projectId, f.milestone) } }
        : { name: { eqIgnoreCase: f.milestone } };
  }
  if (f.label && f.label.length) {
    // Case-insensitive: `in` is exact-case, so `--label bug` silently matched
    // nothing when the label is stored as "Bug" — an empty list, no error.
    //
    // Repeating the flag NARROWS: the issue must carry every label named. It
    // used to broaden (`some: { or: [...] }`), which both contradicted the
    // repeated-filter convention every other flag here follows and silently
    // returned a superset to scripts ported from the reference CLI. Each label
    // needs its own `some` — a single `some` with an `and` would demand one
    // label row match every name at once, which no row ever can.
    filter.labels =
      f.label.length === 1
        ? { some: { name: { eqIgnoreCase: f.label[0] } } }
        : { and: f.label.map((name) => ({ some: { name: { eqIgnoreCase: name } } })) };
  }
  if (f.priority !== undefined) {
    filter.priority = { eq: Number.parseInt(f.priority, 10) };
  }
  if (f.cycle) {
    // A UUID can filter directly; a number/name needs exactly one team to
    // resolve against — cycle numbers restart per team, so "#3" across two
    // teams names two different cycles.
    if (isUuid(f.cycle)) {
      filter.cycle = { id: { eq: f.cycle } };
    } else if (teamKeys.length === 1) {
      const teamForCycle = (await resolveTeam(client, teamKeys[0]!, undefined)).id;
      filter.cycle = { id: { eq: await resolveCycleId(client, teamForCycle, f.cycle) } };
    } else {
      throw usageError(
        "Filtering by a cycle number/name requires exactly one --team (or pass a cycle id).",
      );
    }
  }
  // Inclusive lower bounds, matching the reference CLI's `--created-after` /
  // `--updated-after` (both are `gte`, so a bare YYYY-MM-DD includes that day).
  if (f.createdAfter) {
    filter.createdAt = { gte: parseDateBound(f.createdAfter, "--created-after") };
  }
  if (f.updatedAfter) {
    filter.updatedAt = { gte: parseDateBound(f.updatedAfter, "--updated-after") };
  }
  if (f.query) {
    filter.searchableContent = { contains: f.query };
  }
  return filter;
}

/**
 * Server-side sort spec (correct under pagination — no client-side resort).
 * Takes an already-validated `IssueSort` so an unknown value can never fall
 * through to a silent default; use `resolveIssueSort` to get one. Exported for tests.
 */
export function sortSpec(sort: IssueSort = "priority"): Array<Record<string, unknown>> {
  switch (sort) {
    case "priority":
      // Workflow state first, then priority, then manual: active work groups
      // above the backlog, with urgency as the tiebreak inside each state.
      // Sorting purely by priority interleaved states, floating a backlog item
      // above work in progress.
      //
      // `workflowState: Ascending` is what puts started work on top — verified
      // against the API, where Descending returns Backlog BEFORE In Progress.
      // The reference CLI hardcodes Descending, so a Low-priority backlog issue
      // sorts above an Urgent in-progress one there; we deliberately diverge
      // because workflow state should take precedence over backlog urgency.
      //
      // Descending priority is urgency order (Urgent…Low); `nulls: "last"` keeps
      // "No priority" at the bottom, which is what `noPriorityFirst: false` did.
      return [
        { workflowState: { order: "Ascending" } },
        { priority: { nulls: "last", order: "Descending" } },
        { manual: { nulls: "last", order: "Ascending" } },
      ];
    case "created":
      return [{ createdAt: { order: "Descending" } }];
    case "manual":
      // Linear's board order, without injecting workflow-state or priority
      // grouping. This is the reference CLI's `issue_sort = "manual"` and is
      // useful when a carefully curated backlog should read exactly as arranged.
      return [{ manual: { nulls: "last", order: "Ascending" } }];
    case "updated":
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
  // Sorting is done server-side (see sortSpec), so it is correct across pages.
  return collectRawQuery<IssueRow>(
    client as any,
    LIST_QUERY,
    { filter, sort: sortSpec(filters.sort), includeArchived: !!filters.includeArchived },
    "issues",
    limit,
    toIssueRow,
  );
}

const SEARCH_QUERY = `
query CliSearchIssues($term: String!, $filter: IssueFilter, $first: Int!, $after: String, $includeArchived: Boolean, $includeComments: Boolean) {
  searchIssues(term: $term, filter: $filter, first: $first, after: $after, includeArchived: $includeArchived, includeComments: $includeComments) {
    nodes {
      id identifier title priority priorityLabel estimate url updatedAt ${LIFECYCLE_FIELDS}
      ${ROW_RELATIONS}
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Free-text search via the dedicated searchIssues connection, narrowed by the
 * same filters as `listIssues` (searchIssues takes an IssueFilter).
 *
 * Uses the same tailored-query shape as `listIssues` so both paths return an
 * identical `IssueRow`. The previous SDK-model version resolved state/assignee/
 * project one issue at a time and hardcoded `labels: []`, so `issue search --json`
 * reported no labels while `issue list --json` reported the real ones.
 *
 * Results are relevance-ordered by the API, so there is no sort argument here.
 */
export async function searchIssues(
  client: LinearClient,
  term: string,
  filters: ListFilters,
  limit: number,
  defaultTeamKey: string | undefined,
): Promise<IssueRow[]> {
  const filter = await buildFilter(client, filters, defaultTeamKey);
  return collectRawQuery<IssueRow>(
    client as any,
    SEARCH_QUERY,
    {
      term,
      // An empty filter object is not the same as null to the API; omit it.
      filter: Object.keys(filter).length ? filter : undefined,
      includeArchived: !!filters.includeArchived,
      // Off by default: comment bodies widen a title/description search a lot,
      // and the reference makes it opt-in for the same reason.
      includeComments: !!filters.searchComments,
    },
    "searchIssues",
    limit,
    toIssueRow,
  );
}

/** Map a tailored-query issue node to a display row (shared by list and search). */
function toIssueRow(n: any): IssueRow {
  return {
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
    milestone: n.projectMilestone ?? null,
    cycle: cycleRef(n.cycle),
    labels: (n.labels?.nodes ?? []).map((l: any) => l.name),
    ...lifecycle(n),
  };
}

/** A `cycle { id number name }` selection as the row/detail object; a cycle's name is optional upstream. */
function cycleRef(c: any): IssueRow["cycle"] {
  return c ? { id: c.id, number: c.number, name: c.name ?? null } : null;
}

/** The lifecycle fields off a raw issue node. `trashed` is nullable upstream; null means no. */
function lifecycle(n: any) {
  return {
    archivedAt: n.archivedAt ?? null,
    trashed: n.trashed === true,
    startedAt: n.startedAt ?? null,
    completedAt: n.completedAt ?? null,
    canceledAt: n.canceledAt ?? null,
  };
}

/**
 * A single issue with every relation a `view` shows.
 *
 * Relations are objects, not display strings — the same shape a list row uses
 * for `state`/`assignee`/`project`, so `.state.name` reads the same on both,
 * plus the ids a script needs to act on what it sees. (They used to be
 * flattened to strings here: `team: "TES Test-workspace-bla"` is not even
 * parseable, since a team name can contain spaces.)
 */
export interface IssueDetailRef {
  id: string;
  identifier: string;
  title: string;
  state: { id: string; name: string; type: string } | null;
}

export interface IssueAttachmentDetail {
  id: string;
  title: string;
  url: string;
  subtitle: string | null;
  sourceType: string | null;
  createdAt: string;
}

export interface IssueDocumentDetail {
  id: string;
  title: string;
  slugId: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueRelationDetail {
  id: string;
  type: string;
  issue: IssueDetailRef;
  relatedIssue: IssueDetailRef;
}

/**
 * A comment embedded in `IssueDetail`. It is a superset of the shared comment
 * row: external authors and resolution metadata are retained so a caller can
 * reconstruct threads without another request.
 */
export interface IssueCommentDetail {
  id: string;
  body: string;
  url: string;
  createdAt: string;
  editedAt: string | null;
  resolvedAt: string | null;
  parent: { id: string } | null;
  user: { id: string; displayName: string } | null;
  externalUser: { id: string; displayName: string } | null;
  resolvingCommentId: string | null;
  resolvingUser: { id: string; displayName: string } | null;
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
  archivedAt: string | null;
  trashed: boolean;
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  state: { id: string; name: string; type: string } | null;
  assignee: { id: string; displayName: string; email: string } | null;
  delegate: DelegateRef | null;
  team: { id: string; key: string; name: string } | null;
  project: { id: string; name: string } | null;
  milestone: { id: string; name: string } | null;
  cycle: { id: string; number: number; name: string | null } | null;
  parent: IssueDetailRef | null;
  children: IssueDetailRef[];
  labels: Array<{ id: string; name: string }>;
  subscribers: Array<{ id: string; displayName: string }>;
  attachments: IssueAttachmentDetail[];
  documents: IssueDocumentDetail[];
  relations: IssueRelationDetail[];
  inverseRelations: IssueRelationDetail[];
  comments: IssueCommentDetail[];
}

/** The detail's shape as `linear commands` advertises it; checked against `IssueDetail`. */
export const ISSUE_DETAIL_SHAPE = shape<IssueDetail>({
  id: "string",
  identifier: "string",
  title: "string",
  description: "string|null",
  priority: "number",
  priorityLabel: "string",
  estimate: "number|null",
  url: "string",
  branchName: "string",
  dueDate: "string|null",
  createdAt: "string",
  updatedAt: "string",
  archivedAt: "string|null",
  trashed: "boolean",
  startedAt: "string|null",
  completedAt: "string|null",
  canceledAt: "string|null",
  state: { nullable: { id: "string", name: "string", type: "string" } },
  assignee: { nullable: { id: "string", displayName: "string", email: "string" } },
  delegate: { nullable: { id: "string", displayName: "string", name: "string" } },
  team: { nullable: { id: "string", key: "string", name: "string" } },
  project: { nullable: { id: "string", name: "string" } },
  milestone: { nullable: { id: "string", name: "string" } },
  cycle: { nullable: { id: "string", number: "number", name: "string|null" } },
  parent: {
    nullable: {
      id: "string",
      identifier: "string",
      title: "string",
      state: { nullable: { id: "string", name: "string", type: "string" } },
    },
  },
  children: [
    {
      id: "string",
      identifier: "string",
      title: "string",
      state: { nullable: { id: "string", name: "string", type: "string" } },
    },
  ],
  labels: [{ id: "string", name: "string" }],
  subscribers: [{ id: "string", displayName: "string" }],
  attachments: [
    {
      id: "string",
      title: "string",
      url: "string",
      subtitle: "string|null",
      sourceType: "string|null",
      createdAt: "string",
    },
  ],
  documents: [
    {
      id: "string",
      title: "string",
      slugId: "string",
      url: "string",
      createdAt: "string",
      updatedAt: "string",
    },
  ],
  relations: [
    {
      id: "string",
      type: "string",
      issue: {
        id: "string",
        identifier: "string",
        title: "string",
        state: { nullable: { id: "string", name: "string", type: "string" } },
      },
      relatedIssue: {
        id: "string",
        identifier: "string",
        title: "string",
        state: { nullable: { id: "string", name: "string", type: "string" } },
      },
    },
  ],
  inverseRelations: [
    {
      id: "string",
      type: "string",
      issue: {
        id: "string",
        identifier: "string",
        title: "string",
        state: { nullable: { id: "string", name: "string", type: "string" } },
      },
      relatedIssue: {
        id: "string",
        identifier: "string",
        title: "string",
        state: { nullable: { id: "string", name: "string", type: "string" } },
      },
    },
  ],
  comments: [
    {
      id: "string",
      body: "string",
      url: "string",
      createdAt: "string",
      editedAt: "string|null",
      resolvedAt: "string|null",
      parent: { nullable: { id: "string" } },
      user: { nullable: { id: "string", displayName: "string" } },
      externalUser: { nullable: { id: "string", displayName: "string" } },
      resolvingCommentId: "string|null",
      resolvingUser: { nullable: { id: "string", displayName: "string" } },
    },
  ],
});

/**
 * Everything `issue view` shows, in one round-trip. Selecting the relations in
 * the query is what makes it one: the SDK model's `issue.state`, `.assignee`,
 * `.team`, … are each a lazy request of their own, and the previous version
 * awaited nine of them (8 requests for TES-601, measured).
 *
 * `includeArchived: true` so archived and trashed issues are viewable — they
 * carry `archivedAt`/`trashed` so the caller can say so — and the identifier
 * route filters by team key + number, as `resolveIssue` does, so a lookup never
 * depends on the API accepting human identifiers in `issue(id:)`.
 */
const DETAIL_QUERY = `
query CliIssueDetail($filter: IssueFilter!, $includeComments: Boolean!) {
  issues(filter: $filter, first: 1, includeArchived: true) {
    nodes {
      id identifier title description priority priorityLabel estimate url branchName dueDate
      createdAt updatedAt ${LIFECYCLE_FIELDS}
      state { id name type }
      assignee { id displayName email }
      delegate { id displayName name }
      team { id key name }
      project { id name }
      projectMilestone { id name }
      cycle { id number name }
      parent { id identifier title state { id name type } }
      children(first: 250) { nodes { id identifier title state { id name type } } }
      labels(first: 50) { nodes { id name } }
      subscribers(first: 50) { nodes { id displayName } }
      attachments(first: 50) {
        nodes { id title url subtitle sourceType createdAt }
      }
      documents(first: 50) {
        nodes { id title slugId url createdAt updatedAt }
      }
      relations(first: 50) {
        nodes {
          id type
          issue { id identifier title state { id name type } }
          relatedIssue { id identifier title state { id name type } }
        }
      }
      inverseRelations(first: 50) {
        nodes {
          id type
          issue { id identifier title state { id name type } }
          relatedIssue { id identifier title state { id name type } }
        }
      }
      comments(first: 50, orderBy: createdAt) @include(if: $includeComments) {
        nodes {
          id body url createdAt editedAt resolvedAt resolvingCommentId
          parent { id }
          user { id displayName }
          externalUser { id displayName }
          resolvingUser { id displayName }
        }
      }
    }
  }
}`;

/** Ordinary issue reads remain usable against schemas that predate delegation. */
const DETAIL_QUERY_WITHOUT_DELEGATE = DETAIL_QUERY.replace(
  "      delegate { id displayName name }\n",
  "",
);

const IDENTIFIER_RE = /^([a-zA-Z][a-zA-Z0-9]*)-(\d+)$/;

/** The IssueFilter that names exactly one issue, by UUID or by `TES-123`. */
function detailFilter(input: string): { filter: Record<string, unknown>; label: string } {
  if (isUuid(input)) return { filter: { id: { eq: input } }, label: input };
  const match = input.match(IDENTIFIER_RE);
  if (!match)
    throw usageError(`'${input}' is not a valid issue id (expected e.g. TES-123 or a UUID).`);
  const key = match[1]!.toUpperCase();
  const number = Number.parseInt(match[2]!, 10);
  return {
    filter: { team: { key: { eq: key } }, number: { eq: number } },
    label: `${key}-${number}`,
  };
}

export async function getIssueDetail(
  client: LinearClient,
  idArg: string,
  opts: { includeComments?: boolean } = {},
): Promise<IssueDetail> {
  const { filter, label } = detailFilter(idArg);
  let data: any;
  try {
    data = await withRetry(() =>
      (client as any).client.rawRequest(DETAIL_QUERY, {
        filter,
        includeComments: opts.includeComments !== false,
      }),
    );
  } catch (err) {
    if (!isDelegationReadUnavailable(err)) throw err;
    // `delegate` belongs to Linear for Agents (Developer Preview). An older
    // schema must not break every ordinary `issue view`; retry the established
    // detail query and represent the unavailable relationship as null. Writes
    // and delegate resolution do not use this fallback and still fail closed.
    data = await withRetry(() =>
      (client as any).client.rawRequest(DETAIL_QUERY_WITHOUT_DELEGATE, {
        filter,
        includeComments: opts.includeComments !== false,
      }),
    );
  }
  const n = data.data?.issues?.nodes?.[0];
  if (!n) throw notFound(`No issue ${label}.`);
  return {
    id: n.id,
    identifier: n.identifier,
    title: n.title,
    description: n.description ?? null,
    priority: n.priority,
    priorityLabel: n.priorityLabel,
    estimate: n.estimate ?? null,
    url: n.url,
    branchName: n.branchName,
    dueDate: n.dueDate ?? null,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    ...lifecycle(n),
    state: n.state ?? null,
    assignee: n.assignee ?? null,
    delegate: n.delegate ?? null,
    team: n.team ?? null,
    project: n.project ?? null,
    milestone: n.projectMilestone ?? null,
    cycle: cycleRef(n.cycle),
    parent: n.parent ?? null,
    children: n.children?.nodes ?? [],
    labels: n.labels?.nodes ?? [],
    subscribers: n.subscribers?.nodes ?? [],
    attachments: (n.attachments?.nodes ?? []).map((a: any) => ({
      id: a.id,
      title: a.title,
      url: a.url,
      subtitle: a.subtitle ?? null,
      sourceType: a.sourceType ?? null,
      createdAt: a.createdAt,
    })),
    documents: n.documents?.nodes ?? [],
    relations: n.relations?.nodes ?? [],
    inverseRelations: n.inverseRelations?.nodes ?? [],
    comments: (n.comments?.nodes ?? []).map(toIssueCommentDetail),
  };
}

export interface IssueDelegationReceipt {
  id: string;
  identifier: string;
  url: string;
  assignee: IssueDetail["assignee"];
  delegate: IssueDetail["delegate"];
}

/** Stable relationship receipt used whenever a command changes delegation. */
export function issueDelegationReceipt(detail: IssueDetail): IssueDelegationReceipt {
  return {
    id: detail.id,
    identifier: detail.identifier,
    url: detail.url,
    assignee: detail.assignee,
    delegate: detail.delegate,
  };
}

/**
 * Confirm the authoritative delegate matches the exact nullable mutation input.
 * A mismatch happens after a successful write, so the error says the mutation
 * may have committed rather than pretending it was rejected.
 */
export function verifyIssueDelegate(detail: IssueDetail, input: Record<string, unknown>): void {
  if (!("delegateId" in input)) return;
  const expected = input.delegateId ?? null;
  const actual = detail.delegate?.id ?? null;
  if (actual === expected) return;
  throw new CliError(
    `Issue mutation succeeded, but delegation read-back did not match (expected ${
      expected ?? "no delegate"
    }, got ${actual ?? "no delegate"}). The write may have committed.`,
    "api",
    { expectedDelegateId: expected, actualDelegateId: actual },
    "Re-read the issue before retrying the mutation.",
  );
}

/** Normalize nullable comment relations while preserving thread metadata. */
function toIssueCommentDetail(c: any): IssueCommentDetail {
  return {
    id: c.id,
    body: c.body,
    url: c.url,
    createdAt: c.createdAt,
    editedAt: c.editedAt ?? null,
    resolvedAt: c.resolvedAt ?? null,
    parent: c.parent ?? null,
    user: c.user ?? null,
    externalUser: c.externalUser ?? null,
    resolvingCommentId: c.resolvingCommentId ?? null,
    resolvingUser: c.resolvingUser ?? null,
  };
}

export interface CreateOptions {
  title: string;
  description?: string;
  team?: string;
  assignee?: string;
  delegate?: string;
  /** Explicitly create without a delegate (`delegateId: null`), distinct from omission. */
  clearDelegate?: boolean;
  state?: string;
  priority?: number;
  label?: string[];
  project?: string;
  milestone?: string;
  cycle?: string;
  estimate?: number;
  parent?: string;
  dueDate?: string;
  /** An issue template, by name or id (`templateId`). Wins over the team default. */
  template?: string;
  /**
   * Apply the team's default issue template (`useDefaultTemplate`). On by
   * default: the API applies a team's default template ONLY when asked —
   * verified live, a plain `issueCreate` on a team with a default template
   * comes back with no description — and both Linear's own new-issue form and
   * the reference CLI ask. `false` is `--no-default-template`.
   */
  useDefaultTemplate?: boolean;
}

export interface IssueMutationTarget {
  id: string;
  identifier: string;
}

export interface IssueMutationPlan {
  operation: "issue.create" | "issue.update" | "issue.delegate" | "issue.label.set-group";
  target: IssueMutationTarget | null;
  input: Record<string, any>;
}

export interface IssueLabelRef {
  id: string;
  name: string;
}

export interface IssueLabelGroupResolution {
  group: IssueLabelRef;
  label: IssueLabelRef;
}

export interface IssueLabelGroupPriorState {
  group: IssueLabelRef;
  labels: IssueLabelRef[];
}

export interface IssueLabelGroupReceipt {
  id: string;
  identifier: string;
  changed: boolean;
  mutationSent: boolean;
  groups: IssueLabelGroupResolution[];
}

export interface IssueLabelGroupPlan extends IssueMutationPlan {
  operation: "issue.label.set-group";
  target: IssueMutationTarget;
  changed: boolean;
  groups: IssueLabelGroupResolution[];
  priorState: IssueLabelGroupPriorState[];
  currentLabelIds: string[];
  groupMemberIds: Record<string, string[]>;
}

export interface IssueLabelMetadata extends IssueLabelRef {
  isGroup: boolean;
  archivedAt: string | null;
  team: { id: string; key: string; name: string } | null;
  parent: IssueLabelRef | null;
  inheritedFrom: IssueLabelRef | null;
}

interface GroupAssignment {
  group: string;
  label: string;
}

const ISSUE_LABEL_METADATA_QUERY = `
query CliIssueLabelGroups($first: Int!, $after: String) {
  issueLabels(first: $first, after: $after, includeArchived: true) {
    nodes {
      id name isGroup archivedAt
      team { id key name }
      parent { id name }
      inheritedFrom { id name }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Parse `GROUP=LABEL`, using only the first equals sign as the separator. */
export function parseIssueLabelGroupAssignment(value: string): GroupAssignment {
  const eq = value.indexOf("=");
  const group = eq < 0 ? "" : value.slice(0, eq).trim();
  const label = eq < 0 ? "" : value.slice(eq + 1).trim();
  if (!group || !label) {
    throw usageError(
      `Expected GROUP=LABEL for --set-group, got '${value}'. Quote the whole assignment when it contains spaces.`,
    );
  }
  return { group, label };
}

function labelMatches(label: IssueLabelMetadata, input: string): boolean {
  return isUuid(input) ? label.id === input : label.name === input;
}

function isUsableLabel(label: IssueLabelMetadata, teamId: string): boolean {
  return label.team === null || label.team.id === teamId;
}

function validationError(message: string): CliError {
  return new CliError(message, "validation");
}

function resolveGroup(
  labels: IssueLabelMetadata[],
  input: string,
  teamId: string,
): IssueLabelMetadata {
  const matches = labels.filter((label) => labelMatches(label, input));
  if (matches.length === 0) throw notFound(`No issue label group exactly matching '${input}'.`);
  const inScope = matches.filter((label) => isUsableLabel(label, teamId));
  if (inScope.length === 0) {
    throw validationError(`Issue label group '${input}' is not usable by this issue's team.`);
  }
  const groups = inScope.filter((label) => label.isGroup);
  if (groups.length === 0) {
    throw validationError(`Issue label '${input}' is not a group container.`);
  }
  if (groups.length > 1) {
    throw ambiguous(`Multiple issue label groups are named '${input}'; pass the group id instead.`);
  }
  const group = groups[0]!;
  if (group.archivedAt) throw validationError(`Issue label group '${group.name}' is archived.`);
  return group;
}

function resolveGroupMember(
  labels: IssueLabelMetadata[],
  input: string,
  group: IssueLabelMetadata,
  teamId: string,
): IssueLabelMetadata {
  const direct = labels.filter(
    (label) => label.parent?.id === group.id && labelMatches(label, input),
  );
  if (direct.length > 1) {
    throw ambiguous(
      `Multiple direct members of issue label group '${group.name}' are named '${input}'; pass the label id instead.`,
    );
  }
  if (direct.length === 1) {
    const member = direct[0]!;
    if (!isUsableLabel(member, teamId)) {
      throw validationError(`Issue label '${member.name}' is not usable by this issue's team.`);
    }
    if (member.isGroup) {
      throw validationError(
        `Issue label '${member.name}' is a group container, not an applicable label.`,
      );
    }
    if (member.archivedAt) throw validationError(`Issue label '${member.name}' is archived.`);
    return member;
  }

  const matches = labels.filter((label) => labelMatches(label, input));
  if (matches.length === 0) throw notFound(`No issue label exactly matching '${input}'.`);
  const inScope = matches.filter((label) => isUsableLabel(label, teamId));
  if (inScope.length === 0) {
    throw validationError(`Issue label '${input}' is not usable by this issue's team.`);
  }
  if (inScope.some((label) => label.isGroup)) {
    throw validationError(`Issue label '${input}' is a group container, not an applicable label.`);
  }
  const parents = [
    ...new Set(inScope.map((label) => label.parent?.name).filter((name): name is string => !!name)),
  ];
  const where = parents.length === 1 ? `; it belongs to '${parents[0]}'` : "";
  throw validationError(
    `Issue label '${input}' is not a direct member of group '${group.name}'${where}.`,
  );
}

/**
 * Resolve every requested group replacement and calculate one relative label mutation.
 * Exported so the validation/planning boundary can be tested without an API.
 */
export function planIssueLabelGroupUpdate(
  issue: {
    id: string;
    identifier: string;
    teamId: string;
    currentLabels: IssueLabelRef[];
  },
  labels: IssueLabelMetadata[],
  assignments: string[],
): IssueLabelGroupPlan {
  if (assignments.length === 0) throw usageError("Pass at least one --set-group GROUP=LABEL.");
  const parsed = assignments.map(parseIssueLabelGroupAssignment);
  const requested = new Map<string, IssueLabelGroupResolution>();

  for (const assignment of parsed) {
    const group = resolveGroup(labels, assignment.group, issue.teamId);
    const member = resolveGroupMember(labels, assignment.label, group, issue.teamId);
    const previous = requested.get(group.id);
    if (previous) {
      if (previous.label.id === member.id) continue;
      throw usageError(
        `Issue label group '${group.name}' was assigned both '${previous.label.name}' and '${member.name}'; pass one target per group.`,
      );
    }
    requested.set(group.id, {
      group: { id: group.id, name: group.name },
      label: { id: member.id, name: member.name },
    });
  }

  const currentLabelIds = issue.currentLabels.map((label) => label.id);
  const current = new Set(currentLabelIds);
  const addedLabelIds: string[] = [];
  const removedLabelIds: string[] = [];
  const groups = [...requested.values()];
  const priorState: IssueLabelGroupPriorState[] = [];
  const groupMemberIds: Record<string, string[]> = {};

  for (const resolution of groups) {
    const members = labels.filter(
      (label) => label.parent?.id === resolution.group.id && !label.isGroup,
    );
    groupMemberIds[resolution.group.id] = members.map((label) => label.id);
    const applied = members.filter((label) => current.has(label.id));
    priorState.push({
      group: resolution.group,
      labels: applied.map((label) => ({ id: label.id, name: label.name })),
    });
    if (!current.has(resolution.label.id)) addedLabelIds.push(resolution.label.id);
    for (const label of applied) {
      if (label.id !== resolution.label.id) removedLabelIds.push(label.id);
    }
  }

  const input = {
    addedLabelIds: [...new Set(addedLabelIds)],
    removedLabelIds: [...new Set(removedLabelIds)],
  };
  return {
    operation: "issue.label.set-group",
    target: { id: issue.id, identifier: issue.identifier },
    input,
    changed: input.addedLabelIds.length > 0 || input.removedLabelIds.length > 0,
    groups,
    priorState,
    currentLabelIds,
    groupMemberIds,
  };
}

/** Resolve an issue, its current labels, and every visible label before writing. */
export async function prepareIssueLabelGroupUpdate(
  client: LinearClient,
  idArg: string,
  assignments: string[],
): Promise<IssueLabelGroupPlan> {
  // Malformed syntax fails before even resolving the issue.
  assignments.map(parseIssueLabelGroupAssignment);
  const issue = await resolveIssue(client, idArg);
  const team = await issue.team;
  if (!team) throw usageError("Cannot resolve label groups without an issue team.");
  const currentLabels = await collectIssueLabelRefs(issue);
  const labels = await collectRawQuery<IssueLabelMetadata>(
    client as any,
    ISSUE_LABEL_METADATA_QUERY,
    {},
    "issueLabels",
    Infinity,
    (label) => ({
      id: label.id,
      name: label.name,
      isGroup: !!label.isGroup,
      archivedAt: label.archivedAt ?? null,
      team: label.team ?? null,
      parent: label.parent ?? null,
      inheritedFrom: label.inheritedFrom ?? null,
    }),
  );
  return planIssueLabelGroupUpdate(
    {
      id: issue.id,
      identifier: issue.identifier,
      teamId: team.id,
      currentLabels,
    },
    labels,
    assignments,
  );
}

async function collectIssueLabelRefs(issue: Issue): Promise<IssueLabelRef[]> {
  const labels = await collect(
    (await withRetry(() => issue.labels({ first: 250, includeArchived: true }))) as any,
    Infinity,
  );
  return labels.map((label: any) => ({ id: label.id, name: label.name }));
}

/** Read every current label for post-mutation verification, without a fixed row cap. */
export async function getIssueLabelRefs(
  client: LinearClient,
  idArg: string,
): Promise<IssueLabelRef[]> {
  return collectIssueLabelRefs(await resolveIssue(client, idArg));
}

/** Execute the prepared relative-label mutation, or make an explicit no-op. */
export async function executeIssueLabelGroupUpdate(
  client: LinearClient,
  plan: IssueLabelGroupPlan,
): Promise<boolean> {
  if (!plan.changed) return false;
  await executeIssueUpdate(client, plan);
  return true;
}

export function issueLabelGroupReceipt(
  plan: IssueLabelGroupPlan,
  mutationSent: boolean,
): IssueLabelGroupReceipt {
  return {
    id: plan.target.id,
    identifier: plan.target.identifier,
    changed: plan.changed,
    mutationSent,
    groups: plan.groups,
  };
}

/** Verify every requested member is present and every sibling is absent. */
export function verifyIssueLabelGroups(
  plan: IssueLabelGroupPlan,
  actualLabelIds: string[],
  mutationSent = plan.changed,
): void {
  const actual = new Set(actualLabelIds);
  for (const resolution of plan.groups) {
    const siblings = plan.groupMemberIds[resolution.group.id] ?? [];
    const unexpected = siblings.filter((id) => id !== resolution.label.id && actual.has(id));
    if (actual.has(resolution.label.id) && unexpected.length === 0) continue;
    throw new CliError(
      `Issue label-group read-back did not match for '${resolution.group.name}'.${
        mutationSent ? " The write may have committed." : " No mutation was sent."
      }`,
      "api",
      {
        expectedLabelId: resolution.label.id,
        unexpectedLabelIds: unexpected,
        actualLabelIds,
      },
      "Re-read the issue before retrying the mutation.",
    );
  }
}

/** Build the exact IssueCreateInput without sending a mutation. */
export async function prepareIssueCreate(
  client: LinearClient,
  opts: CreateOptions,
  defaultTeamKey: string | undefined,
): Promise<IssueMutationPlan> {
  if (opts.delegate !== undefined && opts.clearDelegate) {
    throw usageError("Pass either --delegate or --clear-delegate, not both.");
  }
  const team = await resolveTeam(client, opts.team, defaultTeamKey);
  const input: Record<string, any> = { teamId: team.id, title: opts.title };
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.priority !== undefined) input.priority = opts.priority;
  if (opts.estimate !== undefined) input.estimate = opts.estimate;
  if (opts.dueDate) input.dueDate = opts.dueDate;
  if (opts.assignee) input.assigneeId = await resolveUserId(client, opts.assignee);
  if (opts.delegate !== undefined) {
    input.delegateId = (await resolveDelegate(client, opts.delegate, team.id)).id;
  }
  if (opts.clearDelegate) input.delegateId = null;
  if (opts.state) input.stateId = await resolveStateId(client, team.id, opts.state);
  if (opts.label?.length) input.labelIds = await resolveLabelIds(client, opts.label, team.id);
  if (opts.project) input.projectId = await resolveProjectId(client, opts.project);
  if (opts.parent) {
    const parent = await resolveIssue(client, opts.parent);
    input.parentId = parent.id;
    // A sub-issue lands in its parent's project unless told otherwise — what
    // Linear's UI does, and what the reference CLI does. Without this, every
    // `--parent` child sat outside the project its parent belongs to.
    if (!input.projectId) {
      const parentProject = await parent.project;
      if (parentProject) input.projectId = parentProject.id;
    }
  }
  if (opts.milestone) {
    // Resolved after the parent so a milestone can name one in the inherited project.
    if (!input.projectId)
      throw usageError("A milestone requires --project (or a --parent in a project).");
    input.projectMilestoneId = await resolveMilestoneId(client, input.projectId, opts.milestone);
  }
  if (opts.cycle) input.cycleId = await resolveCycleId(client, team.id, opts.cycle);
  // An explicit template overrides the default one, so the two are never sent
  // together. Every other value in the input overrides what the template fills.
  if (opts.template) input.templateId = await resolveTemplateId(client, team.id, opts.template);
  else if (opts.useDefaultTemplate !== false) input.useDefaultTemplate = true;

  return { operation: "issue.create", target: null, input };
}

/** Execute an already-resolved issue create plan. */
export async function executeIssueCreate(client: LinearClient, plan: IssueMutationPlan) {
  try {
    return await unwrapMutation(
      withRetry(() => client.createIssue(plan.input as any)),
      "issue",
      "Issue creation",
    );
  } catch (err) {
    if ("delegateId" in plan.input) throw delegationFeatureError(err);
    throw err;
  }
}

/** Build and execute an issue create, preserving the existing service contract. */
export async function createIssue(
  client: LinearClient,
  opts: CreateOptions,
  defaultTeamKey: string | undefined,
) {
  return executeIssueCreate(client, await prepareIssueCreate(client, opts, defaultTeamKey));
}

export interface UpdateOptions {
  title?: string;
  description?: string;
  /** Move the issue to another team (key, name, or id). Changes its identifier. */
  team?: string;
  assignee?: string;
  delegate?: string;
  state?: string;
  priority?: number;
  project?: string;
  milestone?: string;
  cycle?: string;
  estimate?: number;
  parent?: string;
  dueDate?: string;
  /** Replace the complete label set (including `[]` to clear it). */
  label?: string[];
  addLabel?: string[];
  removeLabel?: string[];
  /** Clear the assignee. Mutually exclusive with `assignee`. */
  unassign?: boolean;
  /** Clear the delegate. Mutually exclusive with `delegate`. */
  clearDelegate?: boolean;
  /** Remove the issue from its cycle. Mutually exclusive with `cycle`. */
  clearCycle?: boolean;
}

/** Build the exact IssueUpdateInput without sending a mutation. */
export async function prepareIssueUpdate(
  client: LinearClient,
  idArg: string,
  opts: UpdateOptions,
  operation: IssueMutationPlan["operation"] = "issue.update",
): Promise<IssueMutationPlan> {
  // Contradictory pairs are a usage error rather than a silent last-one-wins.
  if (opts.unassign && opts.assignee)
    throw usageError("Pass either --assignee or --unassign, not both.");
  if (opts.clearCycle && opts.cycle)
    throw usageError("Pass either --cycle or --clear-cycle, not both.");
  if (opts.clearDelegate && opts.delegate !== undefined)
    throw usageError("Pass either --delegate or --clear-delegate, not both.");
  if (opts.label !== undefined && (opts.addLabel !== undefined || opts.removeLabel !== undefined))
    throw usageError("Pass either --label (replace all) or --add-label/--remove-label, not both.");

  const issue = await resolveIssue(client, idArg);
  const currentTeamId = (await issue.team)?.id;
  const input: Record<string, any> = {};
  // A team move changes what every team-scoped reference in this same command
  // means, so it is resolved first and everything below resolves against the
  // DESTINATION team: `--team ENG --state 'In Review'` has to mean ENG's "In
  // Review", not the state id of a team the issue is about to leave (which the
  // API would reject). Linear itself remaps the workflow state to the
  // equivalent state in the new team and drops the cycle; see the CHANGELOG.
  if (opts.team) input.teamId = (await resolveTeam(client, opts.team, undefined)).id;
  const teamId = input.teamId ?? currentTeamId;
  if (opts.title !== undefined) input.title = opts.title;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.priority !== undefined) input.priority = opts.priority;
  if (opts.estimate !== undefined) input.estimate = opts.estimate;
  if (opts.dueDate !== undefined) input.dueDate = opts.dueDate;
  if (opts.assignee) input.assigneeId = await resolveUserId(client, opts.assignee);
  // null (not undefined) is what clears a relation in Linear's update inputs.
  if (opts.unassign) input.assigneeId = null;
  if (opts.delegate !== undefined) {
    if (!teamId) throw usageError("Cannot resolve a delegate without an issue team.");
    input.delegateId = (await resolveDelegate(client, opts.delegate, teamId)).id;
  }
  if (opts.clearDelegate) input.delegateId = null;
  if (opts.clearCycle) input.cycleId = null;
  if (opts.state) {
    if (!teamId) throw usageError("Cannot resolve state without a team.");
    input.stateId = await resolveStateId(client, teamId, opts.state);
  }
  if (opts.project) input.projectId = await resolveProjectId(client, opts.project);
  if (opts.cycle && teamId) input.cycleId = await resolveCycleId(client, teamId, opts.cycle);
  if (opts.parent) input.parentId = (await resolveIssue(client, opts.parent)).id;
  if (opts.label !== undefined) input.labelIds = await resolveLabelIds(client, opts.label, teamId);
  if (opts.addLabel?.length)
    input.addedLabelIds = await resolveLabelIds(client, opts.addLabel, teamId);
  if (opts.removeLabel?.length)
    input.removedLabelIds = await resolveLabelIds(client, opts.removeLabel, teamId);
  if (opts.milestone) {
    const projectId = input.projectId ?? (await issue.project)?.id;
    if (!projectId)
      throw usageError("A milestone requires the issue to be in a project (or pass --project).");
    input.projectMilestoneId = await resolveMilestoneId(client, projectId, opts.milestone);
  }

  if (Object.keys(input).length === 0)
    throw usageError("Nothing to update; pass at least one field.");
  return {
    operation,
    target: { id: issue.id, identifier: issue.identifier },
    input,
  };
}

/** Execute an already-resolved issue update plan. */
export async function executeIssueUpdate(client: LinearClient, plan: IssueMutationPlan) {
  if (!plan.target) throw usageError("Issue update plan is missing its target.");
  // The updated issue comes from the payload, never from `issue` — falling back
  // to the pre-mutation entity would print "Updated TES-1" for a write the API
  // refused.
  try {
    return await unwrapMutation(
      withRetry(() => client.updateIssue(plan.target!.id, plan.input as any)),
      "issue",
      "Issue update",
    );
  } catch (err) {
    if ("delegateId" in plan.input) throw delegationFeatureError(err);
    throw err;
  }
}

export async function updateIssue(client: LinearClient, idArg: string, opts: UpdateOptions) {
  return executeIssueUpdate(client, await prepareIssueUpdate(client, idArg, opts));
}

export async function archiveIssue(client: LinearClient, idArg: string, unarchive: boolean) {
  const issue = await resolveIssue(client, idArg);
  await assertMutation(
    withRetry(() => (unarchive ? client.unarchiveIssue(issue.id) : client.archiveIssue(issue.id))),
    unarchive ? "Issue unarchive" : "Issue archive",
  );
  return issue;
}

export async function deleteIssue(client: LinearClient, idArg: string) {
  const issue = await resolveIssue(client, idArg);
  await assertMutation(
    withRetry(() => client.deleteIssue(issue.id)),
    "Issue deletion",
  );
  return issue;
}

export async function setSubscription(client: LinearClient, idArg: string, subscribe: boolean) {
  const issue = await resolveIssue(client, idArg);
  await assertMutation(
    withRetry(() =>
      subscribe ? client.issueSubscribe(issue.id) : client.issueUnsubscribe(issue.id),
    ),
    subscribe ? "Issue subscribe" : "Issue unsubscribe",
  );
  return issue;
}

/** The state change `issue start` makes; see `moveIssueState`. */
export interface StartMove {
  /** Move to this state (name or type) instead of the first `started` one. */
  stateInput?: string;
  /** Move to the team's first `started`-type state. */
  move?: boolean;
}

/**
 * Move an issue's state for `start` (and `create --start`). `move` selects the
 * team's first `started`-type state; an explicit `stateInput` is resolved by
 * name/type. Neither → no request. Takes an already-resolved issue so a freshly
 * created one is not looked up a second time.
 */
export async function moveIssueState(client: LinearClient, issue: Issue, opts: StartMove) {
  if (!opts.stateInput && !opts.move) return;
  const teamId = (await issue.team)?.id;
  if (!teamId) throw usageError("Cannot resolve team for state change.");
  const stateId = opts.stateInput
    ? await resolveStateId(client, teamId, opts.stateInput)
    : await firstStateOfType(client, teamId, "started");
  await assertMutation(
    withRetry(() => client.updateIssue(issue.id, { stateId })),
    "Issue update",
  );
}

export async function startIssue(client: LinearClient, idArg: string, opts: StartMove) {
  const issue = await resolveIssue(client, idArg);
  await moveIssueState(client, issue, opts);
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
    await assertMutation(
      withRetry(() =>
        client.createIssueRelation({
          issueId: from.id,
          relatedIssueId: to.id,
          type: apiType as any,
        }),
      ),
      "Relation creation",
    );
  } else {
    // The single relation record may live on either issue (direction matters for
    // blocks/blocked_by). Search `from`'s direct + inverse relations for a record
    // of `apiType` whose source=from and target=to.
    const [direct, inverse] = await Promise.all([
      collect((await withRetry(() => from.relations())) as any, Infinity),
      collect((await withRetry(() => from.inverseRelations())) as any, Infinity),
    ]);
    const match = await findRelation([...direct, ...inverse] as any[], from.id, to.id, apiType);
    if (!match)
      throw notFound(`No ${type} relation between ${issue.identifier} and ${other.identifier}.`);
    await assertMutation(
      withRetry(() => client.deleteIssueRelation(match.id)),
      "Relation removal",
    );
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
