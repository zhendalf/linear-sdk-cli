/**
 * Label service: all SDK access for issue labels lives here so commands stay thin.
 *
 * The list uses a tailored GraphQL query (one round-trip, no N+1 on the team
 * name) and may be scoped to a single team; single mutations use the typed SDK
 * client and unwrap the `{ success, issueLabel }` payload. Labels can be
 * workspace-level (team-less) or scoped to one team.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { shape } from "../lib/shape.js";
import { collectRawQuery } from "../lib/pagination.js";
import { usageError, notFound, ambiguous } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import { resolveTeam, resolveLabelIds, isUuid } from "../lib/resolve.js";

export interface LabelRow {
  id: string;
  name: string;
  color: string;
  isGroup: boolean;
  team: { key: string; name: string } | null;
  parent: { name: string } | null;
}

/** The row's shape as `linear commands` advertises it (TES-610); checked against the interface. */
export const LABEL_ROW_SHAPE = shape<LabelRow>({
  id: "string",
  name: "string",
  color: "string",
  isGroup: "boolean",
  team: { nullable: { key: "string", name: "string" } },
  parent: { nullable: { name: "string" } },
});

const LIST_QUERY = `
query CliIssueLabels($filter: IssueLabelFilter, $first: Int!, $after: String) {
  issueLabels(filter: $filter, first: $first, after: $after) {
    nodes {
      id name color isGroup
      team { key name }
      parent { name }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export interface ListOptions {
  /** Ignore the team argument and the configured default; list the whole workspace. */
  allTeams?: boolean;
}

/**
 * List labels, scoped to the labels an issue in one team can carry.
 *
 * When `teamInput` (or the default team) resolves to a team, the result is that
 * team's labels **plus the workspace-level (team-less) ones** — the same set
 * `resolveLabelIds` accepts for that team, and the set Linear offers in the
 * label picker. It used to filter on `team.key` alone, which silently dropped
 * every workspace label whenever a default team was configured: `label list`
 * showed 5 of the 8 labels valid on the team's issues, and every "no label
 * matching X — run 'linear label list'" error pointed at that incomplete list.
 *
 * `allTeams` (or no team in scope at all) lists every label in the workspace.
 */
export async function listLabels(
  client: LinearClient,
  teamInput: string | undefined,
  limit: number,
  defaultTeamKey: string | undefined,
  opts: ListOptions = {},
): Promise<LabelRow[]> {
  const teamKey = opts.allTeams ? undefined : (teamInput ?? defaultTeamKey);
  let filter: Record<string, any> | undefined;
  if (teamKey) {
    const team = await resolveTeam(client, teamKey, undefined);
    filter = { or: [{ team: { key: { eq: team.key } } }, { team: { null: true } }] };
  }

  return collectRawQuery<LabelRow>(
    client as any,
    LIST_QUERY,
    { filter },
    "issueLabels",
    limit,
    toLabelRow,
  );
}

/** Map a tailored-query label node to a display row. */
function toLabelRow(n: any): LabelRow {
  return {
    id: n.id,
    name: n.name,
    color: n.color,
    isGroup: !!n.isGroup,
    team: n.team ?? null,
    parent: n.parent ?? null,
  };
}

export interface CreateOptions {
  name: string;
  color?: string;
  description?: string;
  team?: string;
  parent?: string;
}

/**
 * Build an IssueLabelCreateInput, resolving every human reference to an id. A
 * team is optional: without one the label is workspace-level. A parent label is
 * resolved within the same team scope when a team is known.
 */
export async function createLabel(
  client: LinearClient,
  opts: CreateOptions,
  defaultTeamKey: string | undefined,
) {
  const input: Record<string, any> = { name: opts.name };
  if (opts.color !== undefined) input.color = opts.color;
  if (opts.description !== undefined) input.description = opts.description;

  // A team is optional; only resolve it when the user asked for one (an explicit
  // --team), so that omitting it yields a workspace-level label.
  let teamId: string | undefined;
  if (opts.team !== undefined) {
    teamId = (await resolveTeam(client, opts.team, defaultTeamKey)).id;
    input.teamId = teamId;
  }
  if (opts.parent) {
    const [parentId] = await resolveLabelIds(client, [opts.parent], teamId);
    input.parentId = parentId;
  }

  return unwrapMutation(
    withRetry(() => client.createIssueLabel(input as any)),
    "issueLabel",
    "Label creation",
  );
}

export interface UpdateOptions {
  name?: string;
  color?: string;
  description?: string;
}

export async function updateLabel(client: LinearClient, idArg: string, opts: UpdateOptions) {
  const id = await resolveLabel(client, idArg);
  const input: Record<string, any> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.color !== undefined) input.color = opts.color;
  if (opts.description !== undefined) input.description = opts.description;

  if (Object.keys(input).length === 0)
    throw usageError("Nothing to update; pass at least one of --name, --color, --description.");

  return unwrapMutation(
    withRetry(() => client.updateIssueLabel(id, input as any)),
    "issueLabel",
    "Label update",
  );
}

export async function deleteLabel(client: LinearClient, idArg: string) {
  const id = await resolveLabel(client, idArg);
  // Fetch the label first so we can report its name after deletion.
  const label = await withRetry(() => client.issueLabel(id));
  await assertMutation(
    withRetry(() => client.deleteIssueLabel(id)),
    "Label deletion",
  );
  return label;
}

/**
 * Resolve a single label reference (UUID or name) to its id. A UUID passes
 * through; a name is matched workspace-wide and must be unambiguous.
 */
async function resolveLabel(client: LinearClient, idArg: string): Promise<string> {
  if (isUuid(idArg)) return idArg;
  const labels = await withRetry(() =>
    client.issueLabels({ filter: { name: { eqIgnoreCase: idArg } } as any, first: 50 }),
  );
  if (labels.nodes.length === 0) throw notFound(`No label matching '${idArg}'.`);
  const exact = labels.nodes.filter((l) => l.name === idArg);
  const finalists = exact.length ? exact : labels.nodes;
  if (finalists.length > 1)
    throw ambiguous(`Multiple labels named '${idArg}'; pass the label id instead.`);
  return finalists[0]!.id;
}
