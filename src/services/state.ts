/**
 * Workflow-state service: all SDK access for workflow states lives here so
 * commands stay thin.
 *
 * A team is resolved from a friendly key/name/id via `resolveTeam`, then its
 * states come from the typed `team.states()` connection (sorted client-side by
 * position). The single `view` resolves a state by id via `client.workflowState`.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { collect, pageSize } from "../lib/pagination.js";
import { resolveTeam } from "../lib/resolve.js";

export interface StateRow {
  id: string;
  name: string;
  type: string;
  position: number;
  color: string;
}

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
  const nodes = await collect(conn as any, limit);
  return nodes.map(toRow).sort((a, b) => a.position - b.position);
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

/** A single workflow state by id (UUID). */
export async function getStateDetail(client: LinearClient, id: string): Promise<StateDetail> {
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
