/** First-class project-label access. Project labels are distinct from issue labels. */

import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { ambiguous, notFound, usageError } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import { collectRawQuery } from "../lib/pagination.js";
import { shape } from "../lib/shape.js";
import { isUuid } from "../lib/resolve.js";

export interface ProjectLabelRow {
  id: string;
  name: string;
  color: string;
  description: string | null;
  isGroup: boolean;
  parent: { id: string; name: string } | null;
  retiredAt: string | null;
}

export interface ProjectLabelDetail extends ProjectLabelRow {
  children: Array<{ id: string; name: string; color: string; retiredAt: string | null }>;
}

export const PROJECT_LABEL_ROW_SHAPE = shape<ProjectLabelRow>({
  id: "string",
  name: "string",
  color: "string",
  description: "string|null",
  isGroup: "boolean",
  parent: { nullable: { id: "string", name: "string" } },
  retiredAt: "string|null",
});

export const PROJECT_LABEL_DETAIL_SHAPE = shape<ProjectLabelDetail>({
  ...PROJECT_LABEL_ROW_SHAPE,
  children: [{ id: "string", name: "string", color: "string", retiredAt: "string|null" }],
});

const FIELDS = `
  id name color description isGroup retiredAt
  parent { id name }
`;

const LIST_QUERY = `
query CliProjectLabels($filter: ProjectLabelFilter, $first: Int!, $after: String, $includeArchived: Boolean) {
  projectLabels(filter: $filter, first: $first, after: $after, includeArchived: $includeArchived) {
    nodes { ${FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

const VIEW_QUERY = `
query CliProjectLabel($id: String!) {
  projectLabel(id: $id) {
    ${FIELDS}
    children(first: 250, includeArchived: true) {
      nodes { id name color retiredAt }
    }
  }
}`;

function row(node: any): ProjectLabelRow {
  return {
    id: node.id,
    name: node.name,
    color: node.color,
    description: node.description ?? null,
    isGroup: !!node.isGroup,
    parent: node.parent ?? null,
    retiredAt: node.retiredAt ?? null,
  };
}

export async function listProjectLabels(
  client: LinearClient,
  limit: number,
  includeRetired = false,
): Promise<ProjectLabelRow[]> {
  return collectRawQuery<ProjectLabelRow>(
    client as any,
    LIST_QUERY,
    { includeArchived: includeRetired },
    "projectLabels",
    limit,
    row,
  );
}

async function resolveProjectLabelId(
  client: LinearClient,
  input: string,
  groupsOnly = false,
): Promise<string> {
  if (isUuid(input)) return input;
  const matches = await collectRawQuery<ProjectLabelRow>(
    client as any,
    LIST_QUERY,
    {
      filter: {
        name: { eqIgnoreCase: input },
        ...(groupsOnly ? { isGroup: { eq: true } } : {}),
      },
      includeArchived: true,
    },
    "projectLabels",
    Infinity,
    row,
  );
  const eligible = groupsOnly ? matches.filter((label) => !label.retiredAt) : matches;
  if (eligible.length === 0)
    throw notFound(
      `No project label matching '${input}'. Run 'linear project-label list --include-retired' to see the options.`,
    );
  const exact = eligible.filter((label) => label.name === input);
  const finalists = exact.length ? exact : eligible;
  if (finalists.length > 1)
    throw ambiguous(`Multiple project labels named '${input}'; pass the project label id instead.`);
  return finalists[0]!.id;
}

export async function getProjectLabel(
  client: LinearClient,
  input: string,
  groupsOnly = false,
): Promise<ProjectLabelDetail> {
  const id = await resolveProjectLabelId(client, input, groupsOnly);
  const response: any = await withRetry(() =>
    (client as any).client.rawRequest(VIEW_QUERY, { id }),
  );
  const label = response.data?.projectLabel;
  if (!label) throw notFound(`No project label matching '${input}'.`);
  return { ...row(label), children: label.children?.nodes ?? [] };
}

function validateName(name: string | undefined): void {
  if (name !== undefined && name.trim().length === 0)
    throw usageError("Label name cannot be empty.");
}

function validateColor(color: string | undefined): void {
  if (color !== undefined && !/^#[0-9a-f]{6}$/i.test(color))
    throw usageError("Label color must be a six-digit hex value such as #5E6AD2.");
}

async function resolveParent(client: LinearClient, input: string): Promise<ProjectLabelDetail> {
  const parent = await getProjectLabel(client, input, true);
  if (!parent.isGroup) throw usageError(`Project label '${parent.name}' is not a label group.`);
  if (parent.retiredAt) throw usageError(`Project label group '${parent.name}' is retired.`);
  return parent;
}

export interface CreateOptions {
  name: string;
  color?: string;
  description?: string;
  group?: boolean;
  parent?: string;
}

export async function createProjectLabel(client: LinearClient, opts: CreateOptions) {
  validateName(opts.name);
  validateColor(opts.color);
  if (opts.group && opts.parent)
    throw usageError("A project label group cannot itself belong to another group.");
  const input: Record<string, unknown> = { name: opts.name.trim() };
  if (opts.color !== undefined) input.color = opts.color;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.group) input.isGroup = true;
  if (opts.parent) input.parentId = (await resolveParent(client, opts.parent)).id;
  return unwrapMutation(
    withRetry(() => client.createProjectLabel(input as any)),
    "projectLabel",
    "Project label creation",
  );
}

export interface UpdateOptions {
  name?: string;
  color?: string;
  description?: string;
  parent?: string;
  clearParent?: boolean;
}

export async function updateProjectLabel(client: LinearClient, input: string, opts: UpdateOptions) {
  validateName(opts.name);
  validateColor(opts.color);
  if (opts.parent && opts.clearParent)
    throw usageError("Pass either --parent or --clear-parent, not both.");
  const current = await getProjectLabel(client, input);
  if (current.isGroup && opts.parent)
    throw usageError("A project label group cannot itself belong to another group.");
  const update: Record<string, unknown> = {};
  if (opts.name !== undefined) update.name = opts.name.trim();
  if (opts.color !== undefined) update.color = opts.color;
  if (opts.description !== undefined) update.description = opts.description;
  if (opts.parent) update.parentId = (await resolveParent(client, opts.parent)).id;
  if (opts.clearParent) update.parentId = null;
  if (Object.keys(update).length === 0)
    throw usageError(
      "Nothing to update; pass at least one of --name, --color, --description, --parent, --clear-parent.",
    );
  return unwrapMutation(
    withRetry(() => client.updateProjectLabel(current.id, update as any)),
    "projectLabel",
    "Project label update",
  );
}

export async function retireProjectLabel(client: LinearClient, input: string) {
  const label = await getProjectLabel(client, input);
  if (label.retiredAt) throw usageError(`Project label '${label.name}' is already retired.`);
  return unwrapMutation(
    withRetry(() => client.projectLabelRetire(label.id)),
    "projectLabel",
    "Project label retirement",
  );
}

export async function restoreProjectLabel(client: LinearClient, input: string) {
  const label = await getProjectLabel(client, input);
  if (!label.retiredAt) throw usageError(`Project label '${label.name}' is not retired.`);
  return unwrapMutation(
    withRetry(() => client.projectLabelRestore(label.id)),
    "projectLabel",
    "Project label restoration",
  );
}

export async function deleteProjectLabel(client: LinearClient, input: string) {
  const label = await getProjectLabel(client, input);
  await assertMutation(
    withRetry(() => client.deleteProjectLabel(label.id)),
    "Project label deletion",
  );
  return label;
}
