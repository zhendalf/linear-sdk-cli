/**
 * Workflow-state service: all SDK access for workflow states lives here so
 * commands stay thin.
 *
 * A team is resolved from a friendly key/name/id via `resolveTeam`, then its
 * states come from the typed `team.states()` connection (sorted client-side by
 * position). The single `view` takes an id, or a name/type resolved within a team.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { shape } from "../lib/shape.js";
import { collect, pageSize, setPaginationMetadata } from "../lib/pagination.js";
import { usageError } from "../lib/errors.js";
import { resolveTeam, resolveStateId, isUuid } from "../lib/resolve.js";

export interface StateRow {
  id: string;
  name: string;
  type: string;
  position: number;
  color: string;
}

/** The row's shape as `linear commands` advertises it (TES-610); checked against the interface. */
export const STATE_ROW_SHAPE = shape<StateRow>({
  id: "string",
  name: "string",
  type: "string",
  position: "number",
  color: "string",
});

/** List a team's workflow states, sorted by position (ascending). */
export async function listStates(
  client: LinearClient,
  teamInput: string | undefined,
  defaultTeamKey: string | undefined,
  limit: number,
): Promise<StateRow[]> {
  const team = await resolveTeam(client, teamInput, defaultTeamKey);
  const teamModel = await withRetry(() => client.team(team.id));
  const conn = await withRetry(() => teamModel.states({ first: pageSize(limit) }));
  // The API's connection order is unrelated to workflow position. Sort the
  // complete small state set, then apply the caller's limit.
  const nodes = await collect(conn as any, Infinity);
  const rows = nodes.map(toRow).sort((a, b) => a.position - b.position);
  return setPaginationMetadata(
    limit === Infinity ? rows : rows.slice(0, limit),
    rows.length > limit,
  );
}

export interface StateDetail {
  id: string;
  name: string;
  type: string;
  position: number;
  color: string;
  description: string | null;
  team: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The detail's shape; checked against `StateDetail`. */
export const STATE_DETAIL_SHAPE = shape<StateDetail>({
  id: "string",
  name: "string",
  type: "string",
  position: "number",
  color: "string",
  description: "string|null",
  team: "string|null",
  createdAt: "string",
  updatedAt: "string",
});

/**
 * A single workflow state, by id or by name/type within a team.
 *
 * A name resolves through `resolveStateId` against `--team` or the configured
 * default — the same lookup `issue create --state` uses — so `state view
 * Backlog` works wherever `issue create --state Backlog` would. Without a team
 * to scope the name, the error says what to pass; the API's own answer for a
 * name was "Could not find referenced WorkflowState", which hid the fact that
 * only ids were ever tried.
 */
export async function getStateDetail(
  client: LinearClient,
  input: string,
  teamKey?: string,
): Promise<StateDetail> {
  let id = input;
  if (!isUuid(input)) {
    if (!teamKey) {
      throw usageError(
        `'${input}' is not a workflow state id; pass --team <KEY> (or set a default team) to look a state up by name.`,
      );
    }
    const team = await resolveTeam(client, teamKey, undefined);
    id = await resolveStateId(client, team.id, input);
  }
  const state = await withRetry(() => client.workflowState(id));
  const team = await state.team;
  return {
    id: state.id,
    name: state.name,
    type: state.type,
    position: state.position,
    color: state.color,
    description: state.description ?? null,
    team: team?.key ?? null,
    createdAt: state.createdAt.toISOString(),
    updatedAt: state.updatedAt.toISOString(),
  };
}

function toRow(s: any): StateRow {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    position: s.position,
    color: s.color,
  };
}
