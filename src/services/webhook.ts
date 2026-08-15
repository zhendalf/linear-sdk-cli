/**
 * Webhook service: all SDK access for webhooks lives here so commands stay thin.
 *
 * Webhooks are workspace-scoped (optionally team-scoped). The list uses the typed
 * SDK connection (relation-light: no per-row fetches), `view` reads a single model,
 * and mutations unwrap the `{ success, webhook }` payload.
 */

import { type LinearClient, WebhookResourceType } from "@linear/sdk";
import { withRetry } from "../client.js";
import { collect } from "../lib/pagination.js";
import { usageError, notFound } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import { resolveTeam } from "../lib/resolve.js";

/** The valid webhook resource-type strings (e.g. "Issue", "IssueSLA"). */
const RESOURCE_TYPES = Object.values(WebhookResourceType);
const RESOURCE_BY_LOWER = new Map(RESOURCE_TYPES.map((t) => [t.toLowerCase(), t]));

/**
 * Validate and normalize user-supplied resource types against the SDK enum,
 * case-insensitively, so a typo or `issue` becomes a clean usage error (with the
 * valid list) instead of an opaque API validation failure.
 */
export function normalizeResourceTypes(input: string[]): string[] {
  const out: string[] = [];
  for (const raw of input) {
    const match = RESOURCE_BY_LOWER.get(raw.toLowerCase());
    if (!match) {
      throw usageError(
        `Unknown webhook resource type '${raw}'. Valid types: ${RESOURCE_TYPES.join(", ")}`,
      );
    }
    if (!out.includes(match)) out.push(match);
  }
  return out;
}

export interface WebhookRow {
  id: string;
  url: string | null;
  enabled: boolean;
  resourceTypes: string[];
  label: string | null;
}

/** All webhooks in the workspace (relation-light, so no N+1). */
export async function listWebhooks(client: LinearClient, limit: number): Promise<WebhookRow[]> {
  const conn = await withRetry(() =>
    client.webhooks({ first: limit === Infinity ? 100 : Math.min(limit, 100) }),
  );
  const nodes = await collect(conn as any, limit);
  return nodes.map((w: any) => ({
    id: w.id,
    url: w.url ?? null,
    enabled: w.enabled,
    resourceTypes: w.resourceTypes ?? [],
    label: w.label ?? null,
  }));
}

export interface WebhookDetail {
  id: string;
  url: string | null;
  enabled: boolean;
  resourceTypes: string[];
  label: string | null;
  allPublicTeams: boolean;
  team: string | null;
  creator: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getWebhookDetail(client: LinearClient, id: string): Promise<WebhookDetail> {
  const webhook = await withRetry(() => client.webhook(id));
  const [team, creator] = await Promise.all([webhook.team, webhook.creator]);
  return {
    id: webhook.id,
    url: webhook.url ?? null,
    enabled: webhook.enabled,
    resourceTypes: webhook.resourceTypes ?? [],
    label: webhook.label ?? null,
    allPublicTeams: webhook.allPublicTeams,
    team: team ? `${team.key} ${team.name}` : null,
    creator: creator?.displayName ?? null,
    createdAt: webhook.createdAt.toISOString(),
    updatedAt: webhook.updatedAt.toISOString(),
  };
}

export interface CreateOptions {
  url: string;
  resourceTypes: string[];
  /** Team to scope the webhook to (key/name/id); from the global --team. */
  team?: string;
  label?: string;
  allPublicTeams?: boolean;
  secret?: string;
}

/** Build a WebhookCreateInput, resolving the team reference (if any) to an id. */
export async function createWebhook(client: LinearClient, opts: CreateOptions) {
  if (!opts.url) throw usageError("A webhook needs a --url.");
  if (!opts.resourceTypes?.length)
    throw usageError("A webhook needs at least one --resource (e.g. Issue, Comment, Project).");

  // A webhook must be scoped to a team or explicitly to all public teams.
  if (!opts.team && !opts.allPublicTeams) {
    throw usageError(
      "A webhook needs a scope: pass --team <KEY> (or set a default team) or --all-public.",
    );
  }

  const input: Record<string, any> = {
    url: opts.url,
    resourceTypes: normalizeResourceTypes(opts.resourceTypes),
  };
  // --all-public and a specific team are mutually exclusive; prefer all-public.
  if (opts.allPublicTeams) input.allPublicTeams = true;
  else if (opts.team) input.teamId = (await resolveTeam(client, opts.team, undefined)).id;
  if (opts.label !== undefined) input.label = opts.label;
  if (opts.secret !== undefined) input.secret = opts.secret;

  return unwrapMutation(
    withRetry(() => client.createWebhook(input as any)),
    "webhook",
    "Webhook creation",
  );
}

export interface UpdateOptions {
  url?: string;
  enabled?: boolean;
  resourceTypes?: string[];
  label?: string;
  secret?: string;
}

export async function updateWebhook(client: LinearClient, id: string, opts: UpdateOptions) {
  const input: Record<string, any> = {};
  if (opts.url !== undefined) input.url = opts.url;
  if (opts.enabled !== undefined) input.enabled = opts.enabled;
  if (opts.resourceTypes !== undefined) {
    if (!opts.resourceTypes.length)
      throw usageError("--resource needs at least one resource type.");
    input.resourceTypes = normalizeResourceTypes(opts.resourceTypes);
  }
  if (opts.label !== undefined) input.label = opts.label;
  if (opts.secret !== undefined) input.secret = opts.secret;

  if (Object.keys(input).length === 0)
    throw usageError("Nothing to update; pass at least one of --url, --enabled/--disabled, --resource.");

  return unwrapMutation(
    withRetry(() => client.updateWebhook(id, input as any)),
    "webhook",
    "Webhook update",
  );
}

export async function deleteWebhook(client: LinearClient, id: string): Promise<WebhookDetail> {
  const webhook = await getWebhookDetail(client, id).catch(() => {
    throw notFound(`No webhook matching '${id}'.`);
  });
  await assertMutation(withRetry(() => client.deleteWebhook(id)), "Webhook deletion");
  return webhook;
}
