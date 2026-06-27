# Feature Parity Analysis — `linear-sdk-cli` vs `linear-cli`

Comparison of **this project** (`linear-sdk-cli`, `/Users/z/code/linear-sdk-cli`) against the
reference CLI (`linear-cli`, `/Users/z/work/linear-cli`, the schpet lineage).

_Generated 2026-06-27. Updated after the parity-ergonomics work landed multi-workspace auth, the
GitHub PR/describe workflow, and the project/initiative status-update groups._

## TL;DR

The two CLIs have **converged on the core workflow** and now differ mostly at the edges:

- **`linear-sdk-cli` (ours) is broader across the Linear data model.** It ships whole resource
  groups the reference lacks: notifications, webhooks, organization, favorites, standalone
  comment threads (reply/resolve), attachment management, users, workflow states, roadmaps, and
  full cycle CRUD.
- **Ours has closed the reference's headline developer-workflow gaps.** Multi-workspace auth
  (`auth list/default/token` + global `--workspace`), the GitHub PR workflow (`issue
  pull-request`/`pr`, `issue describe`), and project/initiative **status updates**
  (`project-update`, `initiative-update`, with `--health`) are all now first-class.
- **`linear-cli` (reference) is still deeper on a few VCS/UX niceties.** It retains jj (jujutsu)
  support and `issue commits`, Linear **agent sessions**, bulk operations, markdown rendering +
  pager + image download, file-upload attachments, and a richer `issue query` (date ranges,
  all-teams, comment search).

Neither is a superset. The remaining gaps in ours are the deferred items listed below; the
reference would still need our whole notification/webhook/org/favorite breadth to match ours.

---

## Architecture

| Aspect | `linear-sdk-cli` (ours) | `linear-cli` (reference) |
|---|---|---|
| API layer | `@linear/sdk` (v87) wrapper | GraphQL codegen (`__codegen__`, typed documents) |
| CLI framework | commander | commander |
| Runtime / build | Bun, raw TS shipped | Bun, raw TS shipped |
| Binary names | `linear` + `lin` | `linear` |
| Auth model | **Multi-workspace** credentials w/ default (+ flag/env override) | **Multi-workspace** credentials w/ default |
| Output | table default, `--json` opt-in | table default, per-command `-j/--json` |
| Rendering | plain text | **charmd markdown render** + hyperlinks + image download |
| Pager | none | auto-pager (`--no-pager`) |
| VCS | git branch inference + GitHub PR (`issue pr`) + `issue describe` | git **and jj (jujutsu)**, GitHub PR, autolinks, `issue commits` |
| Config file | user-config only (never reads project `.linear.toml` key) | `.linear.toml` / `.config/linear.toml` (git-root aware) |
| Raw escape hatch | `api` (rich: query-file, vars-file, operation, raw) | `api` (query, variable, variables-json, paginate) + `schema` dump |

**Global flags — ours is richer.** Ours registers `--json --no-color --api-key --team/-t
--limit/-n --all --fields/-f --yes/-y --quiet/-q --no-input --debug` on *every* command. The
reference's only global is `--workspace`; everything else (`--json`, `--web`, `--limit`,
`--no-pager`) is declared per-command.

---

## Command-group coverage matrix

| Group | Ours | Reference | Notes |
|---|:--:|:--:|---|
| issue | ✅ | ✅ | both have `pr`/`describe`; reference still deeper on `query`/`commits`/`agent-session`/bulk; ours has relations + sub/unsub |
| team | ✅ | ✅ | reference: delete, autolinks, `--private`; ours: states/labels/cycles sub-lists, update |
| project | ✅ | ✅ | near-parity; differing flags |
| milestone | ✅ | ✅ | near-parity |
| cycle | ✅ list/view/**current/create/update** | ⚠️ list/view only | **ours wins** — reference can't create/update cycles |
| label | ✅ | ✅ | near-parity (ours: sub-labels via `--parent`) |
| document | ✅ | ✅ | reference: `--icon`, `-e/--edit`, bulk, `--raw` |
| initiative | ✅ | ✅ | reference: unarchive, add/remove-project, bulk, `--icon`, `--color` |
| user | ✅ list/view/me | ❌ | **ours only** |
| state (workflow) | ✅ list/view | ❌ (only via `team states`) | **ours only** as a group |
| comment (top-level) | ✅ +reply/resolve/unresolve | ⚠️ only `issue comment` | **ours wins** on threads |
| attachment | ✅ list/create/delete | ⚠️ only `issue attach` (file upload) | different shape — see gaps |
| favorite | ✅ | ❌ | **ours only** |
| roadmap | ✅ (deprecated API) | ❌ | **ours only** (limited value — API deprecated) |
| notification | ✅ list/read/unread/read-all/archive/snooze | ❌ | **ours only** |
| organization | ✅ view/members/invites | ❌ | **ours only** |
| webhook | ✅ full CRUD | ❌ | **ours only** |
| **auth (multi-workspace)** | ✅ login/list/default/token/status/logout + global `--workspace` | ✅ login/logout/list/default/token/whoami/status | **near-parity** (ours folds `whoami` into the top-level command) |
| **project-update** | ✅ create/list (+health) | ✅ create/list (+health) | **parity** |
| **initiative-update** | ✅ create/list (+health) | ✅ create/list (+health) | **parity** |
| **schema** dump | ❌ | ✅ | **reference only** (niche — `api` reaches introspection) |
| completion | ✅ | ❌ | **ours only** |
| api | ✅ | ✅ | both |
| config | ✅ (show) | ✅ (generate `.linear.toml`) | different purpose |

---

## Closed since the original analysis

These reference-only gaps have since been implemented in ours and are now first-class:

- **Multi-workspace auth** — `auth login/list/default/token/status/logout` keyed by workspace
  slug, plus a global `--workspace` selector (and `LINEAR_WORKSPACE`). Credential selection is
  flag/`LINEAR_API_KEY` → `--workspace`/env/`default_workspace`, never steered by project files.
- **GitHub PR + `describe` workflow** — `issue pull-request` (`pr`) creates a GH PR via `gh`
  (`--base/--head/--draft/--title/--web`, PR URL the only stdout in `--json`), and `issue
  describe` prints the title + a `Fixes <ID>` / `References <ID>` commit trailer. The id is
  inferred from the branch as usual; it never auto-pushes or creates branches.
- **Status updates** — `project-update` (`pu`) and `initiative-update` (`iu`) with
  `create <ref>` / `list <ref>`, `--body`/`--body-file`/`--editor`, and `--health
  {onTrack,atRisk,offTrack}`.

---

## Gaps in OURS (features the reference still has that we lack)

Ranked by likely user value. These are the items deliberately **deferred**.

### 1. Linear **agent sessions** — *high (forward-looking)*
Reference `issue agent-session list|view` (filter by status). This is Linear's agent feature;
ours has no coverage. → Worth adding given the direction of the product.

### 2. Bulk operations — *medium*
Reference supports `--bulk <ids...> / --bulk-file / --bulk-stdin` on `issue delete`, `document
delete`, `initiative archive/delete`. Ours is one-at-a-time. → Add a shared bulk helper.

### 3. Output ergonomics — markdown rendering, pager, image download — *medium (UX)*
Reference renders issue/project/doc bodies via charmd, auto-pages long output (`--no-pager`), and
downloads inline images (`--no-download`). Ours prints plain text. → Quality-of-life for `view`.

### 4. Richer `issue query` / list filters — *medium*
Reference `issue query`: `--all-teams --search-comments --unassigned --created-after
--updated-after --project-label`, plus `issue mine` with `--web/--app`. Ours `issue list` has
state/assignee/project/label/priority/cycle/query/sort/include-archived but lacks all-teams,
comment search, unassigned, and date-range filters. → Extend our list filters.

### 5. File-upload attachments + `issue attach/link` ergonomics — *medium*
Reference `issue attach <file>` uploads a real file (with `--comment`); `issue link <url>` adds a
URL link. Ours `attachment create` attaches a **URL only** (no file upload). → Add file upload.
(Note: ours additionally has `attachment list/delete`, which the reference lacks.)

### 6. `issue commits` + jj (jujutsu) — *low/medium*
Reference lists commits for an issue and supports jj alongside git. Ours is git-only and has no
`commits` subcommand.

### 7. Smaller items
- `schema` command (dump GraphQL SDL/introspection) — easy, niche (introspection is reachable
  via `api`).
- `team delete` with `--move-issues`, and `team create --private`; `team autolinks`.
- `initiative add-project/remove-project/unarchive`, `--icon`, `--color`.
- `document --icon`, `-e/--edit` (edit current body in `$EDITOR`).
- `-w/--web` / `-a/--app` open flags across list/view commands (ours only has `issue view --web`).
- `issue create --no-use-default-template` (template awareness).

---

## Gaps in the REFERENCE (our advantages)

These are whole areas the reference does **not** cover:

- **Notifications** — `notification list/read/unread/read-all/archive/snooze`.
- **Webhooks** — full CRUD (`list/view/create/update/delete`).
- **Organization** — `organization view/members/invites`.
- **Favorites** — `favorite list/add/remove`.
- **Comment threads** — `reply`, `resolve`, `unresolve` (reference only does add/list/update/delete).
- **Cycle CRUD** — we can `create/update` and resolve `current`; the reference is read-only.
- **Users / Workflow states** as first-class groups (`user list/view/me`, `state list/view`).
- **Attachment management** — `attachment list/delete` (reference can only attach).
- **Issue subscribe/unsubscribe**.
- **Roadmaps** — present (though the Linear roadmap API is deprecated; low value).
- **Shell completion** (`completion bash|zsh|fish`) and the `lin` alias.
- **Richer global flags** — `--fields`, `--all`, global `--limit`, `--quiet`, `--no-input`, `--debug`.

---

## Notable flag-level differences in shared commands

- **Priority:** ours `-P/--priority <0-4>`; reference `-p/--priority <1-4>` (different short flag
  *and* range — reference's `-p` collides with our project short; watch this if cross-porting).
- **Team short flag:** ours global `-t/--team`; reference uses `--team` per-command and `-t` for
  `--title` on `issue create`. Divergent muscle memory.
- **JSON:** ours global `--json`; reference per-command `-j/--json` (not universal).
- **Issue create title:** ours `--title`; reference `-t/--title`.
- **Description from file:** both support `--description-file`; ours also supports `-` for stdin
  consistently across create/update/comment/document.
- **Dates:** ours `--due`; reference `--due-date`. ours uses short kebab forms consistently —
  `--target`/`--start`/`--end` (project, milestone, initiative, cycle); reference
  `--target-date`/`--start-date`.
- **Assignee "me":** ours accepts `me`; reference accepts `self`/`@me`.

---

## Recommended parity roadmap for `linear-sdk-cli`

The foundational items (multi-workspace auth, GitHub PR/`describe`, status updates) have landed.
The remaining, deliberately deferred priorities are:

1. **Agent sessions** (`issue agent-session list/view`) — forward-looking.
2. **Bulk ops** (`--bulk/--bulk-file/--bulk-stdin` shared helper).
3. **Output ergonomics** — markdown rendering + pager + image download on `view`; `-w/--web` /
   `-a/--app` open flags; file-upload attachments.
4. **Filter parity** on `issue list` (`--all-teams`, `--unassigned`, date ranges, comment search).
5. **`issue commits` + jj** support.
6. Minor: `schema` dump, `team delete --move-issues`, `--private`, `document --icon/--edit`.

The reverse (porting our notification/webhook/org/favorite/comment-thread/cycle-CRUD coverage to
the reference) is the bigger lift — our resource breadth is the harder thing to replicate.
