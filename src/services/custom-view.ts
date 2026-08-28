/**
 * Custom-view service: typed @linear/sdk access, input construction, reference
 * validation, pagination, and stable result shaping.
 *
 * Linear's `customViews` query deliberately excludes views scoped to a project
 * or initiative. UUID lookup remains complete, so every single-view operation
 * requires a UUID rather than offering a name lookup over an incomplete set.
 */

import type { CustomView, LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { usageError } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import { collect, inheritPaginationMetadata, pageSize } from "../lib/pagination.js";
import { isUuid, resolveProjectId, resolveTeam, resolveUserId } from "../lib/resolve.js";
import { shape } from "../lib/shape.js";
import { resolveInitiative } from "./initiative.js";

export const CUSTOM_VIEW_TYPES = ["issue", "project", "initiative"] as const;
export type CustomViewType = (typeof CUSTOM_VIEW_TYPES)[number];
type CustomViewCreateInput = Parameters<LinearClient["createCustomView"]>[0];
type CustomViewUpdateInput = Parameters<LinearClient["updateCustomView"]>[1];

export interface CustomViewPerson {
  id: string;
  displayName: string;
}

export interface CustomViewTeam {
  id: string;
  key: string;
  name: string;
}

export interface CustomViewRow {
  id: string;
  name: string;
  type: string;
  shared: boolean;
  owner: CustomViewPerson | null;
  team: CustomViewTeam | null;
  slugId: string;
  updatedAt: string;
}

export const CUSTOM_VIEW_ROW_SHAPE = shape<CustomViewRow>({
  id: "string",
  name: "string",
  type: "string",
  shared: "boolean",
  owner: { nullable: { id: "string", displayName: "string" } },
  team: { nullable: { id: "string", key: "string", name: "string" } },
  slugId: "string",
  updatedAt: "string",
});

export interface CustomViewDetail extends CustomViewRow {
  description: string | null;
  filter: Record<string, unknown>;
  color: string | null;
  icon: string | null;
  creator: CustomViewPerson | null;
  createdAt: string;
  archivedAt: string | null;
}

export const CUSTOM_VIEW_DETAIL_SHAPE = shape<CustomViewDetail>({
  ...CUSTOM_VIEW_ROW_SHAPE,
  description: "string|null",
  filter: "object",
  color: "string|null",
  icon: "string|null",
  creator: { nullable: { id: "string", displayName: "string" } },
  createdAt: "string",
  archivedAt: "string|null",
});

export interface CustomViewResultRow {
  type: CustomViewType;
  id: string;
  identifier: string | null;
  name: string;
  url: string;
}

export const CUSTOM_VIEW_RESULT_ROW_SHAPE = shape<CustomViewResultRow>({
  type: "string",
  id: "string",
  identifier: "string|null",
  name: "string",
  url: "string",
});

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Stable CLI spelling of the API's modelName. */
export function customViewType(modelName: string): string {
  switch (modelName.toLowerCase()) {
    case "issue":
      return "issue";
    case "project":
      return "project";
    case "initiative":
      return "initiative";
    case "feeditem":
      return "feed-item";
    default:
      return modelName;
  }
}

function supportedType(modelName: string): CustomViewType {
  const type = customViewType(modelName);
  if ((CUSTOM_VIEW_TYPES as readonly string[]).includes(type)) return type as CustomViewType;
  throw usageError(
    `Custom view type '${type}' has no matched-entity command in the typed SDK. Supported: ${CUSTOM_VIEW_TYPES.join(
      ", ",
    )}.`,
  );
}

function person(user: any): CustomViewPerson | null {
  return user ? { id: user.id, displayName: user.displayName } : null;
}

function teamRow(team: any): CustomViewTeam | null {
  return team ? { id: team.id, key: team.key, name: team.name } : null;
}

/** Project a model to a row, resolving the two displayed relations. */
export async function toRow(view: CustomView | any): Promise<CustomViewRow> {
  const [owner, team] = await Promise.all([view.owner, view.team]);
  return {
    id: view.id,
    name: view.name,
    type: customViewType(view.modelName),
    shared: view.shared,
    owner: person(owner),
    team: teamRow(team),
    slugId: view.slugId,
    updatedAt: iso(view.updatedAt),
  };
}

export async function listCustomViews(
  client: LinearClient,
  limit: number,
): Promise<CustomViewRow[]> {
  const conn = await withRetry(() => client.customViews({ first: pageSize(limit) }));
  const nodes = await collect(conn as any, limit);
  return inheritPaginationMetadata(await Promise.all(nodes.map(toRow)), nodes);
}

/** UUID-only by design: the list query is not a complete namespace for names. */
export async function resolveCustomView(client: LinearClient, reference: string) {
  if (!isUuid(reference)) {
    throw usageError(
      `A custom view must be referenced by UUID; names are not unique and scoped views are absent from 'custom-view list'.`,
    );
  }
  return withRetry(() => client.customView(reference));
}

function filterOf(view: CustomView | any): Record<string, unknown> {
  switch (customViewType(view.modelName)) {
    case "project":
      return (view.projectFilterData ?? {}) as Record<string, unknown>;
    case "initiative":
      return (view.initiativeFilterData ?? {}) as Record<string, unknown>;
    case "feed-item":
      return (view.feedItemFilterData ?? {}) as Record<string, unknown>;
    default:
      return (view.filterData ?? {}) as Record<string, unknown>;
  }
}

export async function getCustomViewDetail(
  client: LinearClient,
  reference: string,
): Promise<CustomViewDetail> {
  const view = await resolveCustomView(client, reference);
  const [row, creator] = await Promise.all([toRow(view), view.creator]);
  return {
    ...row,
    description: view.description ?? null,
    filter: filterOf(view),
    color: view.color ?? null,
    icon: view.icon ?? null,
    creator: person(creator),
    createdAt: iso(view.createdAt),
    archivedAt: view.archivedAt ? iso(view.archivedAt) : null,
  };
}

export async function listCustomViewResults(
  client: LinearClient,
  reference: string,
  limit: number,
): Promise<CustomViewResultRow[]> {
  const view = await resolveCustomView(client, reference);
  const type = supportedType(view.modelName);
  const first = pageSize(limit);
  const conn =
    type === "issue"
      ? await withRetry(() => view.issues({ first }))
      : type === "project"
        ? await withRetry(() => view.projects({ first }))
        : await withRetry(() => view.initiatives({ first }));
  const nodes = await collect<any>(conn as any, limit);
  const rows = nodes.map((entity: any): CustomViewResultRow => ({
    type,
    id: entity.id,
    identifier: type === "issue" ? entity.identifier : null,
    name: type === "issue" ? entity.title : entity.name,
    url: entity.url,
  }));
  return inheritPaginationMetadata(rows, nodes);
}

export interface CreateCustomViewOptions {
  name: string;
  type: CustomViewType;
  filter?: Record<string, unknown>;
  description?: string;
  color?: string;
  icon?: string;
  owner?: string;
  shared?: boolean;
  scopeTeam?: string;
  scopeProject?: string;
  scopeInitiative?: string;
}

function applyFilter(
  input: CustomViewCreateInput | CustomViewUpdateInput,
  type: CustomViewType,
  filter: Record<string, unknown>,
): void {
  switch (type) {
    case "issue":
      input.filterData = filter as NonNullable<CustomViewCreateInput["filterData"]>;
      break;
    case "project":
      input.projectFilterData = filter as NonNullable<CustomViewCreateInput["projectFilterData"]>;
      break;
    case "initiative":
      input.initiativeFilterData = filter as NonNullable<
        CustomViewCreateInput["initiativeFilterData"]
      >;
      break;
  }
}

async function createScopeInput(
  client: LinearClient,
  opts: Pick<CreateCustomViewOptions, "scopeTeam" | "scopeProject" | "scopeInitiative">,
): Promise<Partial<Pick<CustomViewCreateInput, "teamId" | "projectId" | "initiativeId">>> {
  const scopes = [opts.scopeTeam, opts.scopeProject, opts.scopeInitiative].filter(
    (value) => value !== undefined,
  );
  if (scopes.length > 1) {
    throw usageError("Pass at most one of --scope-team, --scope-project, or --scope-initiative.");
  }
  if (opts.scopeTeam) {
    return { teamId: (await resolveTeam(client, opts.scopeTeam, undefined)).id };
  }
  if (opts.scopeProject) return { projectId: await resolveProjectId(client, opts.scopeProject) };
  if (opts.scopeInitiative) {
    return { initiativeId: (await resolveInitiative(client, opts.scopeInitiative)).id };
  }
  return {};
}

/** Exported for tests: constructs exactly the SDK input sent by create. */
export async function buildCreateCustomViewInput(
  client: LinearClient,
  opts: CreateCustomViewOptions,
): Promise<CustomViewCreateInput> {
  const input: CustomViewCreateInput = { name: opts.name };
  applyFilter(input, opts.type, opts.filter ?? {});
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.color !== undefined) input.color = opts.color;
  if (opts.icon !== undefined) input.icon = opts.icon;
  if (opts.owner) input.ownerId = await resolveUserId(client, opts.owner);
  if (opts.shared !== undefined) input.shared = opts.shared;
  Object.assign(input, await createScopeInput(client, opts));
  return input;
}

export async function createCustomView(client: LinearClient, opts: CreateCustomViewOptions) {
  const input = await buildCreateCustomViewInput(client, opts);
  return unwrapMutation(
    withRetry(() => client.createCustomView(input)),
    "customView",
    "Custom view creation",
  );
}

export interface UpdateCustomViewOptions {
  name?: string;
  filter?: Record<string, unknown>;
  description?: string;
  clearDescription?: boolean;
  color?: string;
  clearColor?: boolean;
  icon?: string;
  clearIcon?: boolean;
  owner?: string;
  shared?: boolean;
  scopeTeam?: string;
  clearTeamScope?: boolean;
}

/** Exported for tests: omits every field the caller did not explicitly set. */
export async function buildUpdateCustomViewInput(
  client: LinearClient,
  view: CustomView | any,
  opts: UpdateCustomViewOptions,
): Promise<CustomViewUpdateInput> {
  const input: CustomViewUpdateInput = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.filter !== undefined) applyFilter(input, supportedType(view.modelName), opts.filter);
  if (opts.description !== undefined && opts.clearDescription) {
    throw usageError("Pass either --description or --clear-description, not both.");
  }
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.clearDescription) input.description = null;
  if (opts.color !== undefined && opts.clearColor) {
    throw usageError("Pass either --color or --clear-color, not both.");
  }
  if (opts.color !== undefined) input.color = opts.color;
  if (opts.clearColor) input.color = null;
  if (opts.icon !== undefined && opts.clearIcon) {
    throw usageError("Pass either --icon or --clear-icon, not both.");
  }
  if (opts.icon !== undefined) input.icon = opts.icon;
  if (opts.clearIcon) input.icon = null;
  if (opts.owner) input.ownerId = await resolveUserId(client, opts.owner);
  if (opts.shared !== undefined) input.shared = opts.shared;
  if (opts.scopeTeam !== undefined && opts.clearTeamScope) {
    throw usageError("Pass either --scope-team or --clear-team-scope, not both.");
  }
  if (opts.scopeTeam !== undefined) {
    input.teamId = (await resolveTeam(client, opts.scopeTeam, undefined)).id;
  }
  if (opts.clearTeamScope) input.teamId = null;
  if (Object.keys(input).length === 0) {
    throw usageError("Nothing to update; pass at least one field.");
  }
  return input;
}

export async function updateCustomView(
  client: LinearClient,
  reference: string,
  opts: UpdateCustomViewOptions,
) {
  const view = await resolveCustomView(client, reference);
  const input = await buildUpdateCustomViewInput(client, view, opts);
  return unwrapMutation(
    withRetry(() => client.updateCustomView(view.id, input)),
    "customView",
    "Custom view update",
  );
}

export async function deleteCustomView(client: LinearClient, reference: string) {
  const view = await resolveCustomView(client, reference);
  await assertMutation(
    withRetry(() => client.deleteCustomView(view.id)),
    "Custom view deletion",
  );
  return view;
}
