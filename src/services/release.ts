/**
 * Releases use the authenticated SDK transport, with explicit GraphQL selections.
 * Tailored projections select related fields and mutation receipts in one request,
 * avoiding per-row SDK relation fetches. Schema contract tests validate documents
 * and variables against a read-only capture of Linear's current schema.
 * No access-key transport or Git attribution is implemented here: linear-release
 * owns those CI workflows. All values travel as variables, never query strings.
 */
import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { CliError, normalizeError, notFound, usageError } from "../lib/errors.js";
import { assertMutation, unwrapMutation } from "../lib/mutation.js";
import { collectRawQuery } from "../lib/pagination.js";
import { shape } from "../lib/shape.js";

interface NamedResource {
  id: string;
  name: string;
}
interface PipelineRef extends NamedResource {
  type: string;
}
interface StageRef extends NamedResource {
  type: string;
  frozen: boolean;
}

export interface ReleaseRow {
  id: string;
  name: string;
  version: string | null;
  commitSha: string | null;
  url: string;
  pipeline: PipelineRef;
  stage: StageRef;
  startDate: string | null;
  targetDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  archivedAt: string | null;
}
export interface ReleaseDetail extends ReleaseRow {
  description: string | null;
  issueCount: number;
}
export const RELEASE_ROW_SHAPE = shape<ReleaseRow>({
  id: "string",
  name: "string",
  version: "string|null",
  commitSha: "string|null",
  url: "string",
  pipeline: { id: "string", name: "string", type: "string" },
  stage: { id: "string", name: "string", type: "string", frozen: "boolean" },
  startDate: "string|null",
  targetDate: "string|null",
  startedAt: "string|null",
  completedAt: "string|null",
  canceledAt: "string|null",
  archivedAt: "string|null",
});
export const RELEASE_DETAIL_SHAPE = shape<ReleaseDetail>({
  ...RELEASE_ROW_SHAPE,
  description: "string|null",
  issueCount: "number",
});
export interface PipelineRow {
  id: string;
  name: string;
  slugId: string;
  type: string;
  url: string;
  isProduction: boolean;
  autoGenerateReleaseNotesOnCompletion: boolean;
  rolloverIssuesOnCompletion: boolean;
  includePathPatterns: string[];
  archivedAt: string | null;
}
export const PIPELINE_ROW_SHAPE = shape<PipelineRow>({
  id: "string",
  name: "string",
  slugId: "string",
  type: "string",
  url: "string",
  isProduction: "boolean",
  autoGenerateReleaseNotesOnCompletion: "boolean",
  rolloverIssuesOnCompletion: "boolean",
  includePathPatterns: ["string"],
  archivedAt: "string|null",
});
export interface StageRow {
  id: string;
  name: string;
  type: string;
  color: string;
  position: number;
  frozen: boolean;
  pipeline: NamedResource;
  archivedAt: string | null;
}
export const STAGE_ROW_SHAPE = shape<StageRow>({
  id: "string",
  name: "string",
  type: "string",
  color: "string",
  position: "number",
  frozen: "boolean",
  pipeline: { id: "string", name: "string" },
  archivedAt: "string|null",
});
export interface NoteRow {
  id: string;
  title: string | null;
  url: string;
  pipeline: NamedResource;
  releaseCount: number;
  firstRelease: NamedResource | null;
  lastRelease: NamedResource | null;
  generationStatus: string | null;
  archivedAt: string | null;
}
export interface NoteDetail extends NoteRow {
  content: string | null;
}
export const NOTE_ROW_SHAPE = shape<NoteRow>({
  id: "string",
  title: "string|null",
  url: "string",
  pipeline: { id: "string", name: "string" },
  releaseCount: "number",
  firstRelease: { nullable: { id: "string", name: "string" } },
  lastRelease: { nullable: { id: "string", name: "string" } },
  generationStatus: "string|null",
  archivedAt: "string|null",
});
export const NOTE_DETAIL_SHAPE = shape<NoteDetail>({ ...NOTE_ROW_SHAPE, content: "string|null" });
export interface ReleaseIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
}
export const RELEASE_ISSUE_SHAPE = shape<ReleaseIssue>({
  id: "string",
  identifier: "string",
  title: "string",
  url: "string",
});
export interface ReleaseLink {
  id: string;
  label: string | null;
  url: string;
}
export const RELEASE_LINK_SHAPE = shape<ReleaseLink>({
  id: "string",
  label: "string|null",
  url: "string",
});

const RELEASE_FIELDS = `id name version commitSha url pipeline { id name type }
  stage { id name type frozen } startDate targetDate startedAt completedAt canceledAt archivedAt`;
const DETAIL_FIELDS = `${RELEASE_FIELDS} description issueCount`;
const PIPELINE_FIELDS = `id name slugId type url isProduction autoGenerateReleaseNotesOnCompletion
  rolloverIssuesOnCompletion includePathPatterns archivedAt`;
const STAGE_FIELDS = `id name type color position frozen pipeline { id name } archivedAt`;
const NOTE_FIELDS = `id title url pipeline { id name } releaseCount firstRelease { id name }
  lastRelease { id name } generationStatus archivedAt`;
const PAGE = `pageInfo { hasNextPage endCursor }`;

/** Preserve the central error/exit contract and add actionable feature context. */
async function rawRequest(
  client: LinearClient,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data: Record<string, any> }> {
  try {
    const result = await client.client.rawRequest<Record<string, any>, Record<string, unknown>>(
      query,
      variables,
    );
    if (!result.data) throw new CliError("The API returned no release data.", "api");
    return { data: result.data };
  } catch (error) {
    const e = normalizeError(error);
    if (e.code !== "feature_not_accessible") throw e;
    throw new CliError(
      e.message,
      e.code,
      e.detail,
      "Releases require a Business or Enterprise workspace and permission to access the pipeline.",
    );
  }
}
function request(client: LinearClient, query: string, variables: Record<string, unknown>) {
  return withRetry(() => rawRequest(client, query, variables));
}
function transport(client: LinearClient) {
  return {
    client: {
      rawRequest: (query: string, variables: Record<string, unknown>) =>
        rawRequest(client, query, variables),
    },
  };
}

export async function listReleases(
  client: LinearClient,
  limit: number,
  opts: {
    pipeline?: string;
    version?: string;
    stageType?: string;
    includeArchived?: boolean;
  } = {},
): Promise<ReleaseRow[]> {
  const filter: Record<string, unknown> = {};
  if (opts.pipeline)
    filter.pipeline = { id: { eq: (await getPipeline(client, opts.pipeline)).id } };
  if (opts.version !== undefined) filter.version = { eq: opts.version };
  if (opts.stageType) filter.stage = { type: { eq: opts.stageType } };
  return collectRawQuery(
    transport(client),
    `query CliReleases($first: Int!, $after: String,
    $filter: ReleaseFilter, $archived: Boolean) {
    releases(first: $first, after: $after, filter: $filter, includeArchived: $archived) {
      nodes { ${RELEASE_FIELDS} } ${PAGE} } }`,
    { filter, archived: opts.includeArchived ?? false },
    "releases",
    limit,
    (n) => n as ReleaseRow,
  );
}

export async function getRelease(client: LinearClient, id: string): Promise<ReleaseDetail> {
  const r = await request(
    client,
    `query CliRelease($id: String!) { release(id: $id) { ${DETAIL_FIELDS} } }`,
    { id },
  );
  if (!r.data?.release) throw notFound(`No release matching '${id}'.`);
  return r.data.release as ReleaseDetail;
}
export async function listPipelines(
  client: LinearClient,
  limit: number,
  includeArchived = false,
): Promise<PipelineRow[]> {
  return collectRawQuery(
    transport(client),
    `query CliReleasePipelines($first: Int!, $after: String, $archived: Boolean) {
    releasePipelines(first: $first, after: $after, includeArchived: $archived) {
      nodes { ${PIPELINE_FIELDS} } ${PAGE} } }`,
    { archived: includeArchived },
    "releasePipelines",
    limit,
    (n) => n as PipelineRow,
  );
}
/** The API accepts UUIDs and slugs; do not guess from potentially duplicate names. */
export async function getPipeline(client: LinearClient, id: string): Promise<PipelineRow> {
  const r = await request(
    client,
    `query CliReleasePipeline($id: String!) {
    releasePipeline(id: $id) { ${PIPELINE_FIELDS} } }`,
    { id },
  );
  if (!r.data?.releasePipeline) throw notFound(`No release pipeline matching '${id}'.`);
  return r.data.releasePipeline as PipelineRow;
}
export async function listStages(
  client: LinearClient,
  pipeline: string,
  limit: number,
  includeArchived = false,
): Promise<StageRow[]> {
  return collectRawQuery(
    transport(client),
    `query CliReleaseStages($id: String!, $first: Int!, $after: String, $archived: Boolean) {
    releasePipeline(id: $id) { stages(first: $first, after: $after, includeArchived: $archived) {
      nodes { ${STAGE_FIELDS} } ${PAGE} } } }`,
    { id: pipeline, archived: includeArchived },
    "releasePipeline.stages",
    limit,
    (n) => n as StageRow,
  );
}
export async function getStage(client: LinearClient, id: string): Promise<StageRow> {
  const r = await request(
    client,
    `query CliReleaseStage($id: String!) { releaseStage(id: $id) { ${STAGE_FIELDS} } }`,
    { id },
  );
  if (!r.data?.releaseStage) throw notFound(`No release stage matching '${id}'.`);
  return r.data.releaseStage as StageRow;
}
export async function listNotes(
  client: LinearClient,
  limit: number,
  opts: {
    pipeline?: string;
    release?: string;
    includeArchived?: boolean;
  } = {},
): Promise<NoteRow[]> {
  const filter: Record<string, unknown> = {};
  if (opts.pipeline)
    filter.pipeline = { id: { eq: (await getPipeline(client, opts.pipeline)).id } };
  if (opts.release) filter.release = { id: { eq: (await getRelease(client, opts.release)).id } };
  return collectRawQuery(
    transport(client),
    `query CliReleaseNotes($first: Int!, $after: String,
    $filter: ReleaseNoteFilter, $archived: Boolean) {
    releaseNotes(first: $first, after: $after, filter: $filter, includeArchived: $archived) {
      nodes { ${NOTE_FIELDS} } ${PAGE} } }`,
    { filter, archived: opts.includeArchived ?? false },
    "releaseNotes",
    limit,
    (n) => n as NoteRow,
  );
}
export async function getNote(client: LinearClient, id: string): Promise<NoteDetail> {
  const r = await request(
    client,
    `query CliReleaseNote($id: String!) { releaseNote(id: $id) {
    ${NOTE_FIELDS} documentContent { content } } }`,
    { id },
  );
  const n = r.data?.releaseNote;
  if (!n) throw notFound(`No release note matching '${id}'.`);
  const { documentContent, ...row } = n;
  return { ...row, content: documentContent?.content ?? null } as NoteDetail;
}

type Resource = "release" | "releasePipeline" | "releaseStage" | "releaseNote";
const RESOURCE_FIELDS = {
  release: DETAIL_FIELDS,
  releasePipeline: PIPELINE_FIELDS,
  releaseStage: STAGE_FIELDS,
  releaseNote: `${NOTE_FIELDS} documentContent { content }`,
};

async function mutate(
  client: LinearClient,
  resource: Resource,
  verb: "Create" | "Update" | "Sync" | "Complete" | "UpdateByPipeline",
  input: object,
  id?: string,
): Promise<any> {
  const name = `${resource}${verb}`;
  const inputType = name[0]!.toUpperCase() + name.slice(1) + "Input!";
  const r = await request(
    client,
    `mutation Cli${name}($input: ${inputType}${id === undefined ? "" : ", $id: String!"}) {
    ${name}(input: $input${id === undefined ? "" : ", id: $id"}) { success ${resource} { ${RESOURCE_FIELDS[resource]} } } }`,
    { input, ...(id === undefined ? {} : { id }) },
  );
  const entity = await unwrapMutation(r.data?.[name], resource, name);
  if (resource !== "releaseNote") return entity;
  const { documentContent, ...row } = entity;
  return { ...row, content: documentContent?.content ?? null };
}

export interface ReleaseInput {
  name?: string;
  description?: string | null;
  version?: string | null;
  commitSha?: string | null;
  stageId?: string;
  startDate?: string | null;
  targetDate?: string | null;
}
function nonempty(value: string, label: string): string {
  if (!value.trim()) throw usageError(`${label} must not be empty.`);
  return value;
}
function changed(input: object): void {
  if (!Object.values(input).some((v) => v !== undefined))
    throw usageError("Nothing to update; pass at least one field.");
}
function validateReleaseInput(input: ReleaseInput): void {
  if (input.name !== undefined) nonempty(input.name, "--name");
  if (typeof input.version === "string") nonempty(input.version, "--release-version");
  if (
    typeof input.commitSha === "string" &&
    !/^[a-f\d]{40}$|^[a-f\d]{64}$/i.test(input.commitSha)
  ) {
    throw usageError("--commit-sha must be a full 40- or 64-character Git commit SHA.");
  }
  for (const key of ["startDate", "targetDate"] as const) {
    const date = input[key];
    if (
      date != null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    ) {
      throw usageError(`${key} must be a real date in YYYY-MM-DD format.`);
    }
  }
}
async function checkStage(client: LinearClient, stageId: string | undefined, pipelineId: string) {
  if (stageId && (await getStage(client, stageId)).pipeline.id !== pipelineId)
    throw usageError("The stage belongs to a different release pipeline.");
}
export async function createRelease(
  client: LinearClient,
  pipeline: string,
  input: ReleaseInput & { name: string },
): Promise<ReleaseDetail> {
  validateReleaseInput(input);
  const p = await getPipeline(client, pipeline);
  await checkStage(client, input.stageId, p.id);
  return mutate(client, "release", "Create", { ...input, pipelineId: p.id });
}
export async function updateRelease(
  client: LinearClient,
  id: string,
  input: ReleaseInput,
): Promise<ReleaseDetail> {
  changed(input);
  validateReleaseInput(input);
  const release = await getRelease(client, id);
  await checkStage(client, input.stageId, release.pipeline.id);
  return mutate(client, "release", "Update", input, release.id);
}

export interface LinkInput {
  url: string;
  label?: string;
}
export interface LifecycleInput {
  name?: string;
  description?: string | null;
  links?: LinkInput[];
}
export interface SyncInput extends LifecycleInput {
  commitSha: string;
  issueReferences?: { identifier: string; commitSha: string }[];
  revertedIssueReferences?: { identifier: string; commitSha: string }[];
}
/** Never silently select the latest release in an overlapping scheduled pipeline. */
export async function syncRelease(
  client: LinearClient,
  pipeline: string,
  version: string,
  input: SyncInput,
): Promise<ReleaseDetail> {
  nonempty(version, "--release-version");
  validateReleaseInput({ ...input, version });
  const p = await getPipeline(client, pipeline);
  return mutate(client, "release", "Sync", { ...input, pipelineId: p.id, version });
}
export async function completeRelease(
  client: LinearClient,
  pipeline: string,
  version: string,
  input: LifecycleInput & { commitSha?: string } = {},
): Promise<ReleaseDetail> {
  nonempty(version, "--release-version");
  validateReleaseInput({ ...input, version });
  const p = await getPipeline(client, pipeline);
  if (p.type !== "scheduled")
    throw usageError("Continuous pipelines complete releases during sync; use release sync.");
  return mutate(client, "release", "Complete", { ...input, pipelineId: p.id, version });
}
export async function updateReleaseVersion(
  client: LinearClient,
  pipeline: string,
  version: string,
  input: LifecycleInput & { stage?: string },
): Promise<ReleaseDetail> {
  nonempty(version, "--release-version");
  changed(input);
  validateReleaseInput(input);
  const p = await getPipeline(client, pipeline);
  return mutate(client, "release", "UpdateByPipeline", { ...input, pipelineId: p.id, version });
}

export interface PipelineInput {
  name?: string;
  type?: string;
  isProduction?: boolean;
  autoGenerateReleaseNotesOnCompletion?: boolean;
  rolloverIssuesOnCompletion?: boolean;
  includePathPatterns?: string[];
  teamIds?: string[];
}
function validatePipelineInput(input: PipelineInput): void {
  if (input.name !== undefined) nonempty(input.name, "--name");
  if (input.type !== undefined && !["scheduled", "continuous"].includes(input.type))
    throw usageError("Pipeline type must be scheduled or continuous.");
}
export async function createPipeline(
  client: LinearClient,
  input: PipelineInput & { name: string; type: string },
): Promise<PipelineRow> {
  validatePipelineInput(input);
  return mutate(client, "releasePipeline", "Create", input);
}
export async function updatePipeline(
  client: LinearClient,
  id: string,
  input: PipelineInput,
): Promise<PipelineRow> {
  changed(input);
  validatePipelineInput(input);
  return mutate(client, "releasePipeline", "Update", input, (await getPipeline(client, id)).id);
}
export interface StageInput {
  name?: string;
  color?: string;
  position?: number;
  frozen?: boolean;
}
function validateStageInput(input: StageInput): void {
  if (input.name !== undefined) nonempty(input.name, "--name");
  if (input.color !== undefined && !/^#[\da-f]{6}$/i.test(input.color))
    throw usageError("--color must be a six-digit HEX color (e.g. '#5e6ad2').");
  if (input.position !== undefined && !Number.isFinite(input.position))
    throw usageError("--position must be a finite number.");
}
export async function createStage(
  client: LinearClient,
  pipeline: string,
  input: StageInput & { name: string; color: string; position: number; type: string },
): Promise<StageRow> {
  validateStageInput(input);
  if (!["planned", "started", "completed", "canceled"].includes(input.type))
    throw usageError("Invalid stage type.");
  if (input.frozen && input.type !== "started")
    throw usageError("Only started stages can be frozen.");
  return mutate(client, "releaseStage", "Create", {
    ...input,
    pipelineId: (await getPipeline(client, pipeline)).id,
  });
}
export async function updateStage(
  client: LinearClient,
  id: string,
  input: StageInput,
): Promise<StageRow> {
  changed(input);
  validateStageInput(input);
  const stage = await getStage(client, id);
  if (input.frozen && stage.type !== "started")
    throw usageError("Only started stages can be frozen.");
  return mutate(client, "releaseStage", "Update", input, stage.id);
}

export interface NoteInput {
  title?: string;
  content?: string;
  releaseIds?: string[];
  rangeFromReleaseId?: string;
  rangeToReleaseId?: string;
}
/** Validate scope before command handlers obtain an authenticated client. */
export function validateNoteScope(input: NoteInput, required: boolean): void {
  const explicit = input.releaseIds !== undefined;
  const range = input.rangeFromReleaseId !== undefined || input.rangeToReleaseId !== undefined;
  if (explicit && range)
    throw usageError("Use --release or --from-release/--to-release, not both.");
  if (explicit && !input.releaseIds!.length)
    throw usageError("At least one --release is required.");
  if (range && (!input.rangeFromReleaseId || !input.rangeToReleaseId))
    throw usageError("--from-release and --to-release must be provided together.");
  if (required && !explicit && !range)
    throw usageError("Provide --release or both --from-release and --to-release.");
}
async function resolveNoteScope(
  client: LinearClient,
  pipelineId: string,
  input: NoteInput,
): Promise<NoteInput> {
  const ids =
    input.releaseIds ??
    [input.rangeFromReleaseId, input.rangeToReleaseId].filter(
      (id): id is string => id !== undefined,
    );
  const releases = await Promise.all(ids.map((id) => getRelease(client, id)));
  if (releases.some((r) => r.pipeline.id !== pipelineId))
    throw usageError("Every covered release must belong to the note's pipeline.");
  if (input.releaseIds) return { ...input, releaseIds: [...new Set(releases.map((r) => r.id))] };
  return releases.length
    ? { ...input, rangeFromReleaseId: releases[0]!.id, rangeToReleaseId: releases[1]!.id }
    : input;
}
export async function createNote(
  client: LinearClient,
  pipeline: string,
  input: NoteInput,
): Promise<NoteDetail> {
  validateNoteScope(input, true);
  const p = await getPipeline(client, pipeline);
  return mutate(client, "releaseNote", "Create", {
    ...(await resolveNoteScope(client, p.id, input)),
    pipelineId: p.id,
  });
}
export async function updateNote(
  client: LinearClient,
  id: string,
  input: NoteInput,
): Promise<NoteDetail> {
  changed(input);
  validateNoteScope(input, false);
  const note = await getNote(client, id);
  return mutate(
    client,
    "releaseNote",
    "Update",
    await resolveNoteScope(client, note.pipeline.id, input),
    note.id,
  );
}

export async function listReleaseIssues(
  client: LinearClient,
  id: string,
  limit: number,
): Promise<ReleaseIssue[]> {
  return collectRawQuery(
    transport(client),
    `query CliReleaseIssues($id: String!, $first: Int!, $after: String) {
    release(id: $id) { issues(first: $first, after: $after) { nodes { id identifier title url } ${PAGE} } } }`,
    { id },
    "release.issues",
    limit,
    (n) => n as ReleaseIssue,
  );
}
export async function listReleaseLinks(
  client: LinearClient,
  id: string,
  limit: number,
): Promise<ReleaseLink[]> {
  return collectRawQuery(
    transport(client),
    `query CliReleaseLinks($id: String!, $first: Int!, $after: String) {
    release(id: $id) { links(first: $first, after: $after) { nodes { id label url } ${PAGE} } } }`,
    { id },
    "release.links",
    limit,
    (n) => n as ReleaseLink,
  );
}
export async function addIssue(client: LinearClient, id: string, issue: string) {
  const release = await getRelease(client, id);
  const r = await request(
    client,
    `mutation CliIssueToReleaseCreate($input: IssueToReleaseCreateInput!) {
    issueToReleaseCreate(input: $input) { success issueToRelease { id issue { id identifier } release { id } } } }`,
    { input: { releaseId: release.id, issueId: issue } },
  );
  const link = await unwrapMutation(
    r.data?.issueToReleaseCreate,
    "issueToRelease",
    "Add issue to release",
  );
  return {
    id: link.id as string,
    releaseId: link.release.id as string,
    issueId: link.issue.id as string,
    identifier: link.issue.identifier as string,
  };
}
export async function removeIssue(client: LinearClient, id: string, issue: string) {
  const release = await getRelease(client, id);
  const r = await request(
    client,
    `mutation CliIssueToReleaseDelete($releaseId: String!, $issueId: String!) {
    issueToReleaseDeleteByIssueAndRelease(releaseId: $releaseId, issueId: $issueId) { success } }`,
    { releaseId: release.id, issueId: issue },
  );
  await assertMutation(r.data?.issueToReleaseDeleteByIssueAndRelease, "Remove issue from release");
  return { releaseId: release.id, issue, removed: true };
}

export async function deleteNote(
  client: LinearClient,
  id: string,
): Promise<{ id: string; deleted: boolean }> {
  const note = await getNote(client, id);
  const r = await request(
    client,
    `mutation CliReleaseNoteDelete($id: String!) { releaseNoteDelete(id: $id) { success } }`,
    { id: note.id },
  );
  await assertMutation(r.data?.releaseNoteDelete, "Release note deletion");
  return { id: note.id, deleted: true };
}
