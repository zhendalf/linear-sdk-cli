/**
 * An "everything succeeds" Linear client for driving whole commands end to end
 * without a network — the stand-in behind the output-shape sweep (TES-610),
 * which runs every command under `--json` and holds what it prints against the
 * shape `linear commands` declares for it.
 *
 * Two halves, because the services reach the API two ways:
 *
 *  - SDK models (`client.team(id)`, `issue.labels()`, `payload.issue`, …) are
 *    served by one recursive Proxy. A property that is a known scalar
 *    (`SCALARS`) is that value; anything else is a lazy relation that can be
 *    awaited (→ an entity), called (→ a promise of a one-node connection, or a
 *    successful mutation payload — the same object plays every role), or read
 *    further. Nothing is refused, so the sweep tests the OUTPUT path, not the
 *    resolvers.
 *
 *  - Tailored `rawRequest` queries are answered from their own selection set:
 *    the query is parsed and every selected field is given a plausible value
 *    (a connection where `nodes` is selected, one node per page; scalars from
 *    the same `SCALARS` table). Because the fake only ever returns what the
 *    query SELECTS, a field an interface promises but the query stopped asking
 *    for comes back `undefined` — and the shape check reports it. That is the
 *    drift TES-652 was.
 */

import { parse, Kind, type SelectionSetNode, type FieldNode } from "graphql";

export const UUID = "11111111-1111-1111-1111-111111111111";
export const OTHER_UUID = "22222222-2222-2222-2222-222222222222";
const DATE = new Date("2026-01-01T00:00:00.000Z");

/**
 * Plausible values by field name, for SDK entities and raw-query scalars
 * alike. A name missing here reads as a lazy relation on an entity and as a
 * string on a raw node — when a shape check then complains that a number came
 * back as something else, the name belongs in this table.
 */
export const SCALARS: Record<string, unknown> = {
  id: UUID,
  identifier: "TES-1",
  number: 3,
  title: "Title",
  name: "Name",
  displayName: "ada",
  key: "TES",
  email: "ada@example.com",
  url: "https://linear.app/x/issue/TES-1",
  urlKey: "acme",
  slugId: "slug",
  body: "body",
  description: "desc",
  content: "content",
  summary: "summary",
  color: "#abcdef",
  icon: null,
  type: "started",
  status: "started",
  health: "onTrack",
  role: "member",
  source: null,
  subtitle: null,
  label: null,
  timezone: "UTC",
  version: null,
  branchName: "tes-1-title",
  priority: 2,
  priorityLabel: "High",
  estimate: 3,
  progress: 0.5,
  position: 1,
  sortOrder: 1,
  scope: 1,
  issueCount: 4,
  memberCount: 2,
  userCount: 5,
  createdIssueCount: 6,
  size: 12,
  createdAt: DATE,
  updatedAt: DATE,
  startsAt: DATE,
  endsAt: DATE,
  startDate: "2026-01-01",
  targetDate: "2026-02-01",
  dueDate: null,
  archivedAt: null,
  completedAt: null,
  canceledAt: null,
  startedAt: null,
  endedAt: null,
  editedAt: null,
  resolvedAt: null,
  readAt: null,
  snoozedUntilAt: null,
  dismissedAt: null,
  lastSeen: null,
  trashed: false,
  enabled: true,
  admin: true,
  active: true,
  guest: false,
  isMe: true,
  isGroup: false,
  private: false,
  external: false,
  cyclesEnabled: true,
  samlEnabled: false,
  scimEnabled: false,
  roadmapEnabled: true,
  allPublicTeams: true,
  resourceTypes: ["Issue"],
  logoUrl: null,
  avatarUrl: null,
  statusLabel: null,
  externalLink: null,
  contentType: "image/png",
  filename: "shot.png",
  assetUrl: "https://uploads.linear.app/x/shot.png",
  uploadUrl: "https://storage.example/upload?signed=1",
  headers: [],
  parameter: null,
  result: null,
  action: null,
  issueId: UUID,
  documentId: UUID,
  templateData: null,
  modelName: "Issue",
  shared: true,
  filterData: {},
  projectFilterData: null,
  initiativeFilterData: null,
  feedItemFilterData: null,
};

/**
 * `status` is a scalar enum on an initiative, a milestone, an invite, … and a
 * relation (`{ id, name, type }`) on a project. One value serves both: a String
 * that JSON prints as "started" and that also has the relation's fields.
 */
const STATUS = Object.assign(new String("started"), { id: UUID, name: "Name", type: "started" });
SCALARS.status = STATUS;

/**
 * Per-run overrides of `SCALARS` (`archivedAt` set for an unarchive, …); the
 * sweep sets them from a drive's `overrides` and clears them after.
 */
let OVERRIDES: Record<string, unknown> = {};
export function setOverrides(o: Record<string, unknown>): void {
  OVERRIDES = o;
}

/** The value of a named scalar for an SDK entity, or undefined when the name is not one. */
function scalarOf(name: string): { hit: true; value: unknown } | { hit: false } {
  if (name in OVERRIDES) return { hit: true, value: OVERRIDES[name] };
  if (name in SCALARS) return { hit: true, value: SCALARS[name] };
  // `initiativeId`, `issueId`, `parentId`, …: an id, like `id`.
  if (/^[a-z]+Id$/.test(name)) return { hit: true, value: UUID };
  return { hit: false };
}

/** A leaf of a raw query. Dates travel as ISO strings on the wire, never as Date objects. */
function rawScalar(name: string): unknown {
  const found = scalarOf(name);
  if (found.hit) return found.value instanceof Date ? found.value.toISOString() : found.value;
  if (name === "hasNextPage") return false;
  if (name === "endCursor") return null;
  if (name === "__typename") return "Thing";
  return name;
}

// ---------------------------------------------------------------------------
// The SDK-model half.
// ---------------------------------------------------------------------------

/**
 * One value that can be an entity, a connection, a mutation payload, and a
 * lazy relation. `lazy` makes it thenable (an `await` yields the settled
 * flavour, whose `then` is undefined so the await terminates).
 */
export function omni(lazy = false): any {
  const settled = (): any => omni(false);
  const target = function () {};
  return new Proxy(target, {
    get(_t, prop) {
      if (typeof prop === "symbol") {
        if (prop === Symbol.toPrimitive) return () => "omni";
        return undefined;
      }
      if (prop === "then")
        return lazy ? (resolve: (v: unknown) => void) => resolve(settled()) : undefined;
      const scalar = scalarOf(prop);
      if (scalar.hit) return scalar.value;
      if (prop === "nodes") return [settled()];
      if (prop === "pageInfo") return { hasNextPage: false, endCursor: null };
      if (prop === "fetchNext") return async () => settled();
      if (prop === "success") return true;
      if (prop === "lastSyncId") return 1;
      if (prop === "toJSON") return () => ({ id: UUID });
      if (prop === "constructor") return Object;
      return omni(true);
    },
    apply() {
      return Promise.resolve(settled());
    },
    has() {
      return true;
    },
  });
}

// ---------------------------------------------------------------------------
// The raw-query half.
// ---------------------------------------------------------------------------

/** Build one node from a selection set: connections where `nodes` is selected, scalars by name. */
function build(selections: SelectionSetNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let typename: string | undefined;
  for (const sel of selections.selections) {
    if (sel.kind === Kind.INLINE_FRAGMENT) {
      // A union: every arm's fields, and the first arm's type as __typename.
      typename ??= sel.typeCondition?.name.value;
      Object.assign(out, build(sel.selectionSet));
      continue;
    }
    if (sel.kind !== Kind.FIELD) continue;
    const field = sel as FieldNode;
    const key = field.alias?.value ?? field.name.value;
    if (!field.selectionSet) {
      out[key] = key === "__typename" && typename ? typename : rawScalar(field.name.value);
      continue;
    }
    // A variant can model a cleared nullable relation (`delegate: null`) while
    // the default sweep still insists that selected relations are populated.
    if (field.name.value in OVERRIDES) {
      out[key] = OVERRIDES[field.name.value];
      continue;
    }
    const inner = build(field.selectionSet);
    // A `parent { id }` that is its own id would make every comment a reply to
    // itself (and vanish from a threaded list); a parent is another record.
    if (field.name.value === "parent" && "id" in inner) inner.id = OTHER_UUID;
    // `nodes { … }` is the one list a tailored query selects: one node per page.
    out[key] = field.name.value === "nodes" ? [inner] : inner;
  }
  if (typename && out.__typename === "Thing") out.__typename = typename;
  return out;
}

/** `rawRequest(query, vars)` → `{ data }` shaped by the query's own selection set. */
export async function fakeRawRequest(query: string): Promise<{ data: Record<string, unknown> }> {
  if (query.includes("CliIssueLabelGroups")) {
    return {
      data: {
        issueLabels: {
          nodes: [
            {
              id: OTHER_UUID,
              name: "Group",
              isGroup: true,
              archivedAt: null,
              team: null,
              parent: null,
              inheritedFrom: null,
            },
            {
              id: UUID,
              name: "Name",
              isGroup: false,
              archivedAt: null,
              team: null,
              parent: { id: OTHER_UUID, name: "Group" },
              inheritedFrom: null,
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };
  }
  const doc = parse(query);
  const op = doc.definitions.find((d) => d.kind === Kind.OPERATION_DEFINITION);
  if (!op || op.kind !== Kind.OPERATION_DEFINITION) throw new Error("fakeRawRequest: no operation");
  return { data: build(op.selectionSet) };
}

/** The client the sweep hands to every command: SDK models by Proxy, raw queries by selection set. */
export function omniClient(): any {
  const base = omni(false);
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "client") return { rawRequest: fakeRawRequest };
      return Reflect.get(target, prop, receiver);
    },
  });
}
