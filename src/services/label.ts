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
import { usageError, notFound, ambiguous } from "../lib/errors.js";
import { resolveTeam, resolveLabelIds, isUuid } from "../lib/resolve.js";

export interface LabelRow {
  id: string;
  name: string;
  color: string;
  isGroup: boolean;
  team: { key: string; name: string } | null;
  parent: { name: string } | null;
}

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

/**
 * List labels, optionally scoped to a single team. When `teamInput` (or the
 * default team) resolves to a team, the filter narrows to that team's labels;
 * otherwise every label in the workspace is returned.
 */
export async function listLabels(
  client: LinearClient,
  teamInput: string | undefined,
  limit: number,
  defaultTeamKey: string | undefined,
): Promise<LabelRow[]> {
  const teamKey = teamInput ?? defaultTeamKey;
  const filter: Record<string, any> = {};
  if (teamKey) {
    const team = await resolveTeam(client, teamKey, undefined);
    filter.team = { key: { eq: team.key } };
  }

  const pageLimit = limit === Infinity ? 100 : Math.min(limit, 100);
  const rows: LabelRow[] = [];
  let after: string | undefined;

  for (;;) {
    const data: any = await withRetry(() =>
      (client.client as any).rawRequest(LIST_QUERY, {
        filter: Object.keys(filter).length ? filter : undefined,
        first: pageLimit,
        after,
      }),
    );
    const conn = data.data.issueLabels;
    for (const n of conn.nodes) {
      rows.push({
        id: n.id,
        name: n.name,
        color: n.color,
        isGroup: !!n.isGroup,
        team: n.team ?? null,
        parent: n.parent ?? null,
      });
      if (rows.length >= limit) break;
    }
    if (rows.length >= limit || !conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return rows;
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

  const payload = await withRetry(() => client.createIssueLabel(input as any));
  const label = await payload.issueLabel;
  if (!label) throw usageError("Label creation returned no label.");
  return label;
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

  const payload = await withRetry(() => client.updateIssueLabel(id, input as any));
  const label = await payload.issueLabel;
  if (!label) throw usageError("Label update returned no label.");
  return label;
}

export async function deleteLabel(client: LinearClient, idArg: string) {
  const id = await resolveLabel(client, idArg);
  // Fetch the label first so we can report its name after deletion.
  const label = await withRetry(() => client.issueLabel(id));
  await withRetry(() => client.deleteIssueLabel(id));
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
