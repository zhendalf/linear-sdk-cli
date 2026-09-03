/**
 * Linear for Agents (Developer Preview) helpers.
 *
 * Delegates are deliberately resolved separately from assignees. A human can
 * own an issue; only an active, assignable app user with access to the issue's
 * team can be delegated the work.
 */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { CliError, ambiguous, normalizeError, notFound } from "./errors.js";
import { isUuid } from "./resolve.js";

const PAGE_SIZE = 250;
const SCAN_CAP = 2000;
const MAX_LISTED = 25;

export interface DelegateRef {
  id: string;
  displayName: string;
  name: string;
}

function delegationMessages(err: unknown): { normalized: CliError; messages: string } {
  const normalized = normalizeError(err);
  return {
    normalized,
    messages: [normalized.message, JSON.stringify(normalized.detail ?? "")].join(" "),
  };
}

function missingDelegationSchema(messages: string): boolean {
  return (
    /(cannot query field|unknown (argument|field)|is not defined by type).*(delegate|isAssignable|canAccessAnyPublicTeam)/i.test(
      messages,
    ) ||
    /(delegateId|delegate|isAssignable|canAccessAnyPublicTeam).*(cannot query field|unknown (argument|field)|is not defined by type)/i.test(
      messages,
    )
  );
}

/** Whether an issue read can safely retry without its one preview-only field. */
export function isDelegationReadUnavailable(err: unknown): boolean {
  const { normalized, messages } = delegationMessages(err);
  return (
    missingDelegationSchema(messages) ||
    (normalized.code === "feature_not_accessible" && /delegate/i.test(messages))
  );
}

interface DelegateCandidate extends DelegateRef {
  active: boolean;
  app: boolean;
  isAssignable: boolean;
  canAccessAnyPublicTeam: boolean;
  teams: { nodes: Array<{ id: string }> };
}

const CANDIDATE_FIELDS = `
  id displayName name active app isAssignable canAccessAnyPublicTeam
  teams(filter: { id: { eq: $teamId } }, first: 1) { nodes { id } }
`;

const CANDIDATES_QUERY = `
query CliDelegateCandidates($teamId: String!, $after: String) {
  users(first: ${PAGE_SIZE}, after: $after, includeDisabled: true, includeArchived: true) {
    nodes { ${CANDIDATE_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const CANDIDATE_QUERY = `
query CliDelegateCandidate($id: String!, $teamId: String!) {
  user(id: $id) { ${CANDIDATE_FIELDS} }
}
`;

/**
 * Turn an unavailable Developer Preview schema/feature into a stable boundary.
 * Other validation failures retain their original code and wording.
 */
export function delegationFeatureError(err: unknown): CliError {
  const { normalized, messages } = delegationMessages(err);
  const schemaMissing = missingDelegationSchema(messages);
  if (normalized.code !== "feature_not_accessible" && !schemaMissing) return normalized;
  return new CliError(
    "Issue delegation is unavailable in this Linear workspace or API schema (Linear for Agents is in Developer Preview).",
    "feature_not_accessible",
    normalized.detail,
    "Enable an assignable agent integration with access to this team, or retry when the workspace supports issue delegation.",
  );
}

async function request<T>(client: LinearClient, query: string, variables: object): Promise<T> {
  try {
    const response: any = await withRetry(() =>
      (client as any).client.rawRequest(query, variables),
    );
    return response.data as T;
  } catch (err) {
    throw delegationFeatureError(err);
  }
}

async function allCandidates(client: LinearClient, teamId: string): Promise<DelegateCandidate[]> {
  const candidates: DelegateCandidate[] = [];
  let after: string | undefined;
  for (;;) {
    const data = await request<{
      users: {
        nodes: DelegateCandidate[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>(client, CANDIDATES_QUERY, { teamId, after });
    candidates.push(...data.users.nodes);
    if (!data.users.pageInfo.hasNextPage) return candidates;
    if (candidates.length >= SCAN_CAP || !data.users.pageInfo.endCursor) {
      throw new CliError(
        `More than ${SCAN_CAP} workspace users to search; pass the agent user UUID instead.`,
        "usage",
      );
    }
    after = data.users.pageInfo.endCursor;
  }
}

function isBaseEligible(candidate: DelegateCandidate): boolean {
  return candidate.active && candidate.app && candidate.isAssignable;
}

function hasTeamAccess(candidate: DelegateCandidate, privateTeam: boolean): boolean {
  return candidate.teams.nodes.length > 0 || (!privateTeam && candidate.canAccessAnyPublicTeam);
}

function label(candidate: DelegateCandidate): string {
  const names =
    candidate.displayName === candidate.name
      ? candidate.displayName
      : `${candidate.displayName} (${candidate.name})`;
  return `${names} [${candidate.id}]`;
}

function validateCandidate(
  candidate: DelegateCandidate,
  team: { key: string; private: boolean },
): DelegateRef {
  if (!candidate.active) {
    throw new CliError(
      `'${candidate.displayName}' is inactive and cannot be delegated issues.`,
      "validation",
    );
  }
  if (!candidate.app) {
    throw new CliError(
      `'${candidate.displayName}' is a human user. Use --assignee for people; --delegate accepts agent app users only.`,
      "validation",
    );
  }
  if (!candidate.isAssignable) {
    throw new CliError(
      `'${candidate.displayName}' is an app user but is not eligible for issue delegation.`,
      "validation",
      undefined,
      "Reinstall or reconfigure the agent with Linear's app:assignable scope.",
    );
  }
  if (!hasTeamAccess(candidate, team.private)) {
    throw new CliError(
      `'${candidate.displayName}' cannot access team ${team.key} and cannot be delegated this issue.`,
      "validation",
      undefined,
      "Ask a Linear workspace admin to grant the agent access to this team.",
    );
  }
  return { id: candidate.id, displayName: candidate.displayName, name: candidate.name };
}

/**
 * Resolve an agent by UUID, exact display name, or exact full name. Exact case
 * wins over case-insensitive matching; ambiguity considers eligible app users
 * only and lists safe names plus IDs.
 */
export async function resolveDelegate(
  client: LinearClient,
  input: string,
  teamId: string,
): Promise<DelegateRef> {
  let team: { key: string; private: boolean };
  try {
    const model: any = await withRetry(() => client.team(teamId));
    team = { key: model.key, private: !!model.private };
  } catch (err) {
    throw delegationFeatureError(err);
  }

  if (isUuid(input)) {
    const data = await request<{ user: DelegateCandidate | null }>(client, CANDIDATE_QUERY, {
      id: input,
      teamId,
    });
    if (!data.user) throw notFound(`No agent user with id '${input}'.`);
    return validateCandidate(data.user, team);
  }

  const candidates = await allCandidates(client, teamId);
  const exact = candidates.filter(
    (candidate) => candidate.displayName === input || candidate.name === input,
  );
  const lower = input.toLocaleLowerCase();
  const matching = exact.length
    ? exact
    : candidates.filter(
        (candidate) =>
          candidate.displayName.toLocaleLowerCase() === lower ||
          candidate.name.toLocaleLowerCase() === lower,
      );
  const eligible = matching.filter(
    (candidate) => isBaseEligible(candidate) && hasTeamAccess(candidate, team.private),
  );
  if (eligible.length > 1) {
    throw ambiguous(
      `Multiple eligible agents match '${input}': ${eligible.map(label).join(", ")}. Pass the agent user UUID.`,
    );
  }
  if (eligible.length === 1) return validateCandidate(eligible[0]!, team);
  if (matching.length > 0) return validateCandidate(matching[0]!, team);

  const available = candidates.filter(
    (candidate) => isBaseEligible(candidate) && hasTeamAccess(candidate, team.private),
  );
  const suffix =
    available.length === 0
      ? " No eligible agents can access this team."
      : available.length > MAX_LISTED
        ? ` Run 'linear user list --all' to inspect workspace users.`
        : ` Available agents: ${available.map(label).join(", ")}.`;
  throw notFound(`No eligible agent matching '${input}'.${suffix}`);
}
