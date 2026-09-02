/**
 * What every command prints under `--json`, by command path — the `output`
 * field of `linear commands --json` (TES-610).
 *
 * Why a registry keyed by path, and why here: the row and detail shapes are
 * declared beside the interfaces they describe (`ISSUE_ROW_SHAPE` next to
 * `IssueRow`, …), where `shape<T>()` makes any disagreement with the interface a
 * compile error. Mutation receipts, though, are object literals at the emit
 * site in `src/commands/*` with no type of their own; a shape for one is a
 * second copy of the same keys, and the only thing that can keep the copy
 * honest is running the command — which is exactly what
 * `test/unit/output-shapes.test.ts` does for every path in this table, against
 * the shape declared here. The same test refuses a command that has no entry
 * at all, so a new command cannot ship undocumented.
 *
 * `null` marks a command that never prints anything as JSON on its own (a
 * group whose only job is to hold subcommands); it is omitted from the
 * emitted node. A group that runs a default subcommand carries that
 * subcommand's shape, because `linear issue --json` really does print it.
 */

import type { FieldShape, ObjectFields, OutputShape } from "./shape.js";
import { shape } from "./shape.js";
import { AGENT_SESSION_DETAIL_SHAPE, AGENT_SESSION_ROW_SHAPE } from "../services/agent-session.js";
import { ATTACHMENT_ROW_SHAPE } from "../services/attachment.js";
import { COMMENT_ROW_SHAPE } from "../services/comment.js";
import { CYCLE_DETAIL_SHAPE, CYCLE_ROW_SHAPE } from "../services/cycle.js";
import {
  CUSTOM_VIEW_DETAIL_SHAPE,
  CUSTOM_VIEW_RESULT_ROW_SHAPE,
  CUSTOM_VIEW_ROW_SHAPE,
} from "../services/custom-view.js";
import type { DocumentDetail, DocumentRow, DocumentTargets } from "../services/document.js";
import { FAVORITE_ROW_SHAPE } from "../services/favorite.js";
import {
  INITIATIVE_DETAIL_SHAPE,
  INITIATIVE_ROW_SHAPE,
  PROJECT_LINK_SHAPE,
} from "../services/initiative.js";
import { ISSUE_DETAIL_SHAPE, ISSUE_ROW_SHAPE } from "../services/issue.js";
import { LABEL_ROW_SHAPE } from "../services/label.js";
import { MILESTONE_DETAIL_SHAPE, MILESTONE_ROW_SHAPE } from "../services/milestone.js";
import { MARK_ALL_ITEM_SHAPE, NOTIFICATION_ROW_SHAPE } from "../services/notification.js";
import {
  INVITE_ROW_SHAPE,
  ORGANIZATION_DETAIL_SHAPE,
  ORGANIZATION_MEMBER_ROW_SHAPE,
} from "../services/organization.js";
import {
  PROJECT_DETAIL_SHAPE,
  PROJECT_MILESTONE_ROW_SHAPE,
  PROJECT_ROW_SHAPE,
} from "../services/project.js";
import { ROADMAP_DETAIL_SHAPE, ROADMAP_ROW_SHAPE } from "../services/roadmap.js";
import { STATE_DETAIL_SHAPE, STATE_ROW_SHAPE } from "../services/state.js";
import {
  TEAM_CYCLE_ROW_SHAPE,
  TEAM_DETAIL_SHAPE,
  TEAM_LABEL_ROW_SHAPE,
  TEAM_MEMBER_ROW_SHAPE,
  TEAM_ROW_SHAPE,
  TEAM_STATE_ROW_SHAPE,
} from "../services/team.js";
import { USER_DETAIL_SHAPE, USER_ROW_SHAPE } from "../services/user.js";
import { WEBHOOK_DETAIL_SHAPE, WEBHOOK_ROW_SHAPE } from "../services/webhook.js";
import type { UpdateRow } from "../lib/status-update.js";
import type { SettingOrigin, SettingOrigins } from "../config.js";
import type { CommandNode } from "./introspect.js";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const list = (fields: ObjectFields, extra: Partial<OutputShape> = {}): OutputShape => ({
  kind: "list",
  fields,
  ...extra,
});
const object = (fields: ObjectFields, extra: Partial<OutputShape> = {}): OutputShape => ({
  kind: "object",
  fields,
  ...extra,
});
const receipt = (fields: ObjectFields, extra: Partial<OutputShape> = {}): OutputShape => ({
  kind: "receipt",
  fields,
  ...extra,
});
/** A group whose default subcommand's output this is. */
const runs = (sub: string, out: OutputShape): OutputShape => ({
  ...out,
  note: `runs \`${sub}\` by default${out.note ? `; ${out.note}` : ""}`,
});

// ---------------------------------------------------------------------------
// Shapes that have no service interface of their own, or whose service file
// is not the place for them.
// ---------------------------------------------------------------------------

/** Documents attach to one of six targets; the row and the detail share them. */
const DOCUMENT_TARGETS_SHAPE = shape<DocumentTargets>({
  project: { nullable: { id: "string", name: "string" } },
  issue: { nullable: { id: "string", identifier: "string" } },
  initiative: { nullable: { id: "string", name: "string" } },
  team: { nullable: { id: "string", key: "string", name: "string" } },
  cycle: { nullable: { id: "string", number: "number", name: "string|null" } },
  release: { nullable: { id: "string", name: "string", version: "string|null" } },
});
export const DOCUMENT_ROW_SHAPE = shape<DocumentRow>({
  ...DOCUMENT_TARGETS_SHAPE,
  id: "string",
  title: "string",
  url: "string",
  updatedAt: "string",
});
export const DOCUMENT_DETAIL_SHAPE = shape<DocumentDetail>({
  ...DOCUMENT_TARGETS_SHAPE,
  id: "string",
  title: "string",
  content: "string|null",
  url: "string",
  slugId: "string",
  icon: "string|null",
  color: "string|null",
  createdAt: "string",
  updatedAt: "string",
  creator: { nullable: { id: "string", displayName: "string" } },
});

/** A project/initiative status update, as `list` rows it and `create` returns it (+ url). */
export const UPDATE_ROW_SHAPE = shape<UpdateRow>({
  id: "string",
  createdAt: "string",
  user: "string",
  body: "string",
  health: "string|null",
});
const UPDATE_RECEIPT_SHAPE = shape<UpdateRow & { url: string }>({
  ...UPDATE_ROW_SHAPE,
  url: "string",
});

/** `whoami` / `auth whoami`. */
const WHOAMI_SHAPE: ObjectFields = {
  id: "string",
  name: "string",
  displayName: "string",
  email: "string",
  admin: "boolean",
  organization: { id: "string", name: "string", urlKey: "string" },
};

const SETTING_ORIGIN_SHAPE = shape<SettingOrigin>({
  source: "string",
  "path?": "string",
  "key?": "string",
  "workspace?": "string",
});
const SETTING_ORIGINS_SHAPE = shape<SettingOrigins>({
  team: SETTING_ORIGIN_SHAPE,
  workspace: SETTING_ORIGIN_SHAPE,
  sort: SETTING_ORIGIN_SHAPE,
});

/** `config show`: every resolved setting, redacted, with its provenance. */
const CONFIG_SHOW_SHAPE: ObjectFields = {
  apiKey: "string",
  apiKeySource: "string",
  accessToken: "string",
  accessTokenSource: "string",
  credentialWorkspace: "string|null",
  workspaceProfile: "string|null",
  team: "string|null",
  workspace: "string|null",
  sort: "string",
  origins: SETTING_ORIGINS_SHAPE,
  userConfigPath: "string",
  projectConfigPath: "string|null",
  globalConfigPath: "string|null",
};

/** A node of `linear commands --json` — this very table, described in its own terms. */
export const COMMAND_NODE_SHAPE = shape<CommandNode>({
  path: "string",
  description: "string",
  aliases: ["string"],
  arguments: [{ name: "string", required: "boolean", variadic: "boolean" }],
  options: [
    {
      flags: "string",
      description: "string",
      attribute: "string",
      valueRequired: "boolean",
      valueOptional: "boolean",
      variadic: "boolean",
      "choices?": ["string"],
      "defaultValue?": "unknown",
      global: "boolean",
      applicable: "boolean",
    },
  ],
  "output?": {
    kind: "string",
    "fields?": "object",
    "note?": "string",
    "variants?": "object",
  },
});

// Receipts shared by several commands.
const ISSUE_REF: ObjectFields = { id: "string", identifier: "string" };
const ISSUE_URL_RECEIPT: ObjectFields = { ...ISSUE_REF, url: "string" };
const NAMED_URL_RECEIPT: ObjectFields = { id: "string", name: "string", url: "string" };
const NAMED_DELETED: ObjectFields = { id: "string", name: "string", deleted: "boolean" };
const NAMED_ARCHIVED: ObjectFields = { id: "string", name: "string", archived: "boolean" };
const UPLOADED_FILE: ObjectFields = {
  filename: "string",
  assetUrl: "string",
  contentType: "string",
  size: "number",
};
const COMMENT_ADD_RECEIPT: ObjectFields = {
  id: "string",
  issue: "string",
  url: "string",
  "attachments?": [UPLOADED_FILE],
};
const COMMENT_UPDATE_RECEIPT: ObjectFields = { id: "string", url: "string" };
const COMMENT_DELETE_RECEIPT: ObjectFields = { id: "string", deleted: "boolean" };
const WEBHOOK_RECEIPT: ObjectFields = {
  id: "string",
  url: "string|null",
  enabled: "boolean",
  resourceTypes: ["string"],
};
const RELATION_ROW: ObjectFields = { type: "string", issue: "string", title: "string" };

const ISSUE_VIEW = object(ISSUE_DETAIL_SHAPE, {
  variants: {
    "--web": receipt({ ...ISSUE_URL_RECEIPT, opened: "boolean" }),
    "--app": receipt({ ...ISSUE_URL_RECEIPT, opened: "boolean" }),
  },
});
const ISSUE_LIST = list(ISSUE_ROW_SHAPE);
const CYCLE_VIEW = object(CYCLE_DETAIL_SHAPE);
const USER_VIEW = object(USER_DETAIL_SHAPE);
const WHOAMI = object(WHOAMI_SHAPE);
const RAW_API: OutputShape = {
  kind: "raw",
  note: "the response `data` as the API returned it (`--raw`: {data, extensions}); `--paginate` prints one array of every page's nodes",
};

// ---------------------------------------------------------------------------
// The table. One entry per command path (`linear commands --json | jq '.[].path'`).
// ---------------------------------------------------------------------------

export const OUTPUT_SHAPES: Record<string, OutputShape | null> = {
  api: RAW_API,

  attachment: null,
  "attachment create": receipt({ id: "string", title: "string", url: "string" }),
  "attachment delete": receipt({ id: "string", title: "string", deleted: "boolean" }),
  "attachment list": list(ATTACHMENT_ROW_SHAPE),

  auth: null,
  "auth adopt": receipt({
    success: "boolean",
    workspace: "string",
    user: { id: "string", name: "string", email: "string" },
    storage: "string",
    path: "string",
  }),
  "auth default": receipt({ success: "boolean", default_workspace: "string", path: "string" }),
  "auth list": list({
    slug: "string",
    isDefault: "boolean",
    credentialType: "string",
    storage: "string",
  }),
  "auth login": receipt({
    success: "boolean",
    credentialType: "string",
    workspace: "string",
    user: { id: "string", name: "string", email: "string" },
    storage: "string",
    "scopes?": ["string"],
    "expiresAt?": "string",
    path: "string",
  }),
  "auth logout": receipt({
    success: "boolean",
    workspace: "string",
    removed: "boolean",
    revocation: "string",
    fallbackCredentialType: "string|null",
    teamMetadataRemoved: "boolean",
  }),
  "auth migrate": receipt({ success: "boolean", migrated: ["string"], path: "string" }),
  "auth status": object({
    authenticated: "boolean",
    credentialType: "string|null",
    source: "string",
    workspace: "string|null",
    key: "string",
    keyring: "string|null",
    scopes: { nullable: ["string"] },
    expiresAt: "string|null",
  }),
  "auth token": object({ apiKey: "string", workspace: "string|null" }),
  "auth whoami": WHOAMI,

  commands: list(COMMAND_NODE_SHAPE, {
    note: "`output` is absent on a group that only holds subcommands",
    variants: { "[path]": object(COMMAND_NODE_SHAPE) },
  }),

  comment: null,
  "comment add": receipt(COMMENT_ADD_RECEIPT, { note: "`attachments` only with --attach" }),
  "comment delete": receipt(COMMENT_DELETE_RECEIPT),
  "comment list": list(COMMENT_ROW_SHAPE),
  "comment reply": receipt({ id: "string", parent: "string", issue: "string|null", url: "string" }),
  "comment resolve": receipt({ id: "string", resolved: "boolean" }),
  "comment unresolve": receipt({ id: "string", resolved: "boolean" }),
  "comment update": receipt(COMMENT_UPDATE_RECEIPT),

  completion: { kind: "none", note: "always prints a shell script; --json has no effect" },

  config: runs("config show", object(CONFIG_SHOW_SHAPE)),
  "config init": receipt({ success: "boolean", path: "string", team: "string", "sort?": "string" }),
  "config set": receipt({
    success: "boolean",
    path: "string",
    key: "string",
    value: "string",
    "workspace?": "string",
  }),
  "config show": object(CONFIG_SHOW_SHAPE),

  cycle: null,
  "cycle create": receipt({ id: "string", number: "number" }),
  "cycle current": CYCLE_VIEW,
  "cycle list": list(CYCLE_ROW_SHAPE),
  "cycle update": receipt({ id: "string", number: "number" }),
  "cycle view": CYCLE_VIEW,

  "custom-view": runs("custom-view view", object(CUSTOM_VIEW_DETAIL_SHAPE)),
  "custom-view create": receipt({
    id: "string",
    name: "string",
    type: "string",
    shared: "boolean",
    slugId: "string",
  }),
  "custom-view delete": receipt(NAMED_DELETED),
  "custom-view list": list(CUSTOM_VIEW_ROW_SHAPE),
  "custom-view results": list(CUSTOM_VIEW_RESULT_ROW_SHAPE),
  "custom-view update": receipt({
    id: "string",
    name: "string",
    type: "string",
    shared: "boolean",
    slugId: "string",
  }),
  "custom-view view": object(CUSTOM_VIEW_DETAIL_SHAPE),

  document: runs("document view", object(DOCUMENT_DETAIL_SHAPE)),
  "document create": receipt({ id: "string", title: "string", url: "string" }),
  "document delete": receipt({ id: "string", title: "string", deleted: "boolean" }),
  "document list": list(DOCUMENT_ROW_SHAPE),
  "document update": receipt({ id: "string", title: "string", url: "string" }),
  "document view": object(DOCUMENT_DETAIL_SHAPE),

  favorite: null,
  "favorite add": receipt({ id: "string", type: "string" }),
  "favorite list": list(FAVORITE_ROW_SHAPE),
  "favorite remove": receipt({ id: "string", removed: "boolean" }),

  initiative: runs("initiative view", object(INITIATIVE_DETAIL_SHAPE)),
  "initiative add-project": receipt(PROJECT_LINK_SHAPE),
  "initiative archive": receipt(NAMED_ARCHIVED),
  "initiative create": receipt(NAMED_URL_RECEIPT),
  "initiative delete": receipt(NAMED_DELETED),
  "initiative list": list(INITIATIVE_ROW_SHAPE),
  "initiative remove-project": receipt({ ...PROJECT_LINK_SHAPE, removed: "boolean" }),
  "initiative unarchive": receipt(NAMED_ARCHIVED),
  "initiative update": receipt(NAMED_URL_RECEIPT),
  "initiative view": object(INITIATIVE_DETAIL_SHAPE),

  "initiative-update": null,
  "initiative-update create": receipt(UPDATE_RECEIPT_SHAPE),
  "initiative-update list": list(UPDATE_ROW_SHAPE),

  issue: runs("issue view", ISSUE_VIEW),
  "issue agent-session": null,
  "issue agent-session list": list(AGENT_SESSION_ROW_SHAPE),
  "issue agent-session view": object(AGENT_SESSION_DETAIL_SHAPE),
  "issue archive": receipt(
    { ...ISSUE_REF, archived: "boolean" },
    {
      variants: {
        "--bulk": receipt({
          action: "string",
          results: [
            {
              input: "string",
              "id?": "string",
              "identifier?": "string",
              "archived?": "boolean",
              "deleted?": "boolean",
              "error?": { message: "string", code: "string" },
            },
          ],
          succeeded: "number",
          failed: "number",
        }),
      },
    },
  ),
  "issue assign": receipt(ISSUE_REF),
  "issue attach": list(
    {
      id: "string",
      title: "string",
      url: "string",
      assetUrl: "string",
      contentType: "string",
      size: "number",
      "comment?": { id: "string", url: "string" },
    },
    { note: "one row per uploaded file; `comment` is on every row when --comment posted one" },
  ),
  "issue branch": receipt({ branch: "string" }),
  "issue comment": receipt(
    { id: "string", issue: "string" },
    { note: "the bare form adds a comment; add/list/update/delete are subcommands" },
  ),
  "issue comment add": receipt(COMMENT_ADD_RECEIPT, { note: "`attachments` only with --attach" }),
  "issue comment delete": receipt(COMMENT_DELETE_RECEIPT),
  "issue comment list": list(COMMENT_ROW_SHAPE),
  "issue comment update": receipt(COMMENT_UPDATE_RECEIPT),
  "issue comments": list(COMMENT_ROW_SHAPE),
  "issue create": receipt(ISSUE_URL_RECEIPT, {
    variants: {
      "--start": receipt({
        ...ISSUE_URL_RECEIPT,
        branch: "string",
        checkedOut: "boolean",
        stateChanged: "boolean",
      }),
    },
  }),
  "issue delete": receipt(
    { ...ISSUE_REF, deleted: "boolean" },
    {
      variants: {
        "--bulk": receipt({
          action: "string",
          results: [
            {
              input: "string",
              "id?": "string",
              "identifier?": "string",
              "archived?": "boolean",
              "deleted?": "boolean",
              "error?": { message: "string", code: "string" },
            },
          ],
          succeeded: "number",
          failed: "number",
        }),
      },
    },
  ),
  "issue describe": receipt(
    { identifier: "string", title: "string", url: "string", trailer: "string", message: "string" },
    {
      note: "`trailer` is the magic-word phrase (Fixes TES-1); `message` the full commit text as printed",
    },
  ),
  "issue id": receipt({ id: "string" }, { note: "`id` is the identifier (TES-123), not the UUID" }),
  "issue label": receipt(ISSUE_REF),
  "issue list": ISSUE_LIST,
  "issue mine": ISSUE_LIST,
  "issue pull-request": receipt(
    { url: "string", identifier: "string", title: "string" },
    { variants: { "--web": receipt({ web: "boolean", identifier: "string" }) } },
  ),
  "issue relation": receipt(
    {
      issueId: "string",
      issueIdentifier: "string",
      otherId: "string",
      otherIdentifier: "string",
      type: "string",
      op: "string",
    },
    { note: "for op=add|remove", variants: { "op=list": list(RELATION_ROW) } },
  ),
  "issue search": ISSUE_LIST,
  "issue start": receipt({
    ...ISSUE_REF,
    branch: "string",
    checkedOut: "boolean",
    stateChanged: "boolean",
  }),
  "issue state": receipt(ISSUE_REF),
  "issue subscribe": receipt({ ...ISSUE_REF, subscribed: "boolean" }),
  "issue title": receipt({ title: "string" }),
  "issue unarchive": receipt({ ...ISSUE_REF, archived: "boolean" }),
  "issue unsubscribe": receipt({ ...ISSUE_REF, subscribed: "boolean" }),
  "issue update": receipt(ISSUE_URL_RECEIPT),
  "issue url": receipt({ url: "string" }),
  "issue view": ISSUE_VIEW,

  label: null,
  "label create": receipt({ id: "string", name: "string", color: "string" }),
  "label delete": receipt(NAMED_DELETED),
  "label list": list(LABEL_ROW_SHAPE),
  "label update": receipt({ id: "string", name: "string", color: "string" }),

  milestone: null,
  "milestone create": receipt({ id: "string", name: "string" }),
  "milestone delete": receipt(NAMED_DELETED),
  "milestone list": list(MILESTONE_ROW_SHAPE),
  "milestone update": receipt({ id: "string", name: "string" }),
  "milestone view": object(MILESTONE_DETAIL_SHAPE),

  notification: null,
  "notification archive": receipt({ id: "string", archived: "boolean" }),
  "notification list": list(NOTIFICATION_ROW_SHAPE),
  "notification read": receipt({ id: "string", read: "boolean" }),
  "notification read-all": receipt({
    success: "boolean",
    count: "number",
    attempted: "number",
    failed: [MARK_ALL_ITEM_SHAPE],
  }),
  "notification snooze": receipt({ id: "string", snoozedUntilAt: "string" }),
  "notification unread": receipt({ id: "string", read: "boolean" }),

  open: receipt({ target: "string", url: "string", label: "string", opened: "boolean" }),

  organization: runs("organization view", object(ORGANIZATION_DETAIL_SHAPE)),
  "organization invites": list(INVITE_ROW_SHAPE),
  "organization members": list(ORGANIZATION_MEMBER_ROW_SHAPE),
  "organization view": object(ORGANIZATION_DETAIL_SHAPE),

  project: runs("project view", object(PROJECT_DETAIL_SHAPE)),
  "project archive": receipt(NAMED_ARCHIVED),
  "project create": receipt(NAMED_URL_RECEIPT),
  "project delete": receipt(NAMED_DELETED),
  "project list": list(PROJECT_ROW_SHAPE),
  "project milestones": list(PROJECT_MILESTONE_ROW_SHAPE),
  "project update": receipt(NAMED_URL_RECEIPT),
  "project view": object(PROJECT_DETAIL_SHAPE),

  "project-update": null,
  "project-update create": receipt(UPDATE_RECEIPT_SHAPE),
  "project-update list": list(UPDATE_ROW_SHAPE),

  roadmap: runs("roadmap view", object(ROADMAP_DETAIL_SHAPE)),
  "roadmap create": receipt(NAMED_URL_RECEIPT),
  "roadmap delete": receipt(NAMED_DELETED),
  "roadmap list": list(ROADMAP_ROW_SHAPE),
  "roadmap update": receipt(NAMED_URL_RECEIPT),
  "roadmap view": object(ROADMAP_DETAIL_SHAPE),

  schema: {
    kind: "raw",
    note: "the GraphQL introspection result ({__schema: …}); with -o <file> it is written there and stdout stays empty",
  },

  state: null,
  "state list": list(STATE_ROW_SHAPE),
  "state view": object(STATE_DETAIL_SHAPE),

  team: null,
  "team create": receipt(TEAM_ROW_SHAPE),
  "team cycles": list(TEAM_CYCLE_ROW_SHAPE),
  "team delete": receipt({
    ...TEAM_ROW_SHAPE,
    deleted: "boolean",
    movedIssues: "number",
    movedTo: { nullable: TEAM_ROW_SHAPE },
  }),
  "team id": receipt(TEAM_ROW_SHAPE),
  "team labels": list(TEAM_LABEL_ROW_SHAPE),
  "team list": list(TEAM_ROW_SHAPE),
  "team members": list(TEAM_MEMBER_ROW_SHAPE),
  "team states": list(TEAM_STATE_ROW_SHAPE),
  "team update": receipt(TEAM_ROW_SHAPE),
  "team view": object(TEAM_DETAIL_SHAPE),

  user: null,
  "user list": list(USER_ROW_SHAPE),
  "user me": USER_VIEW,
  "user view": USER_VIEW,

  webhook: runs("webhook view", object(WEBHOOK_DETAIL_SHAPE)),
  "webhook create": receipt(WEBHOOK_RECEIPT),
  "webhook delete": receipt({ id: "string", deleted: "boolean" }),
  "webhook list": list(WEBHOOK_ROW_SHAPE),
  "webhook update": receipt(WEBHOOK_RECEIPT),
  "webhook view": object(WEBHOOK_DETAIL_SHAPE),

  whoami: WHOAMI,
};

/** The declared output of one command path, or undefined when it prints no JSON of its own. */
export function outputShapeOf(path: string): OutputShape | undefined {
  return OUTPUT_SHAPES[path] ?? undefined;
}

// Re-exported so the tests (and `commands`) can speak of a field shape without importing shape.ts.
export type { FieldShape };
