# Feature Parity Analysis — `linear-sdk-cli` vs `linear-cli`

Comparison of **this project** (`linear-sdk-cli`, `/Users/z/code/linear-sdk-cli`) against the
reference CLI (`linear-cli`, `/Users/z/work/linear-cli`, the schpet lineage).

_Generated 2026-06-27._

## TL;DR

The two CLIs have **diverged in coverage philosophy**, not just implementation:

- **`linear-sdk-cli` (ours) is broader across the Linear data model.** It ships whole resource
  groups the reference lacks: notifications, webhooks, organization, favorites, standalone
  comment threads (reply/resolve), attachment management, users, workflow states, roadmaps, and
  full cycle CRUD.
- **`linear-cli` (reference) is deeper on the developer/VCS workflow.** It ships multi-workspace
  auth, GitHub PR creation, jj/git commit integration, Linear **agent sessions**, bulk
  operations, markdown rendering + image download, status updates (project & initiative), and a
  richer `issue query`.

Neither is a superset. To reach parity *with the reference*, ours needs ~9 capability areas
(below). The reference would need ~10 to match ours.

---

## Architecture

| Aspect | `linear-sdk-cli` (ours) | `linear-cli` (reference) |
|---|---|---|
| API layer | `@linear/sdk` (v87) wrapper | GraphQL codegen (`__codegen__`, typed documents) |
| CLI framework | commander | commander |
| Runtime / build | Bun, raw TS shipped | Bun, raw TS shipped |
| Binary names | `linear` + `lin` | `linear` |
| Auth model | **Single** API key (flag/env/user-config) | **Multi-workspace** credentials w/ default |
| Output | table default, `--json` opt-in | table default, per-command `-j/--json` |
| Rendering | plain text | **charmd markdown render** + hyperlinks + image download |
| Pager | none | auto-pager (`--no-pager`) |
| VCS | git branch inference | git **and jj (jujutsu)**, GitHub PR, autolinks |
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
| issue | ✅ | ✅ | reference deeper (query, pr, commits, agent-session, bulk); ours has relations + sub/unsub |
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
| **auth (multi-workspace)** | ⚠️ login/status/logout | ✅ login/logout/list/default/token/whoami/status | **reference wins** |
| **project-update** | ❌ (only `project updates` list) | ✅ create/list (+health) | **reference only** |
| **initiative-update** | ❌ | ✅ create/list (+health) | **reference only** |
| **schema** dump | ❌ | ✅ | **reference only** |
| completion | ✅ | ❌ | **ours only** |
| api | ✅ | ✅ | both |
| config | ✅ (show) | ✅ (generate `.linear.toml`) | different purpose |

---

## Gaps in OURS (features the reference has that we lack)

Ranked by likely user value.

### 1. Multi-workspace auth — *high*
Reference: `auth list`, `auth default`, `auth token`, `auth whoami`, plus a global `--workspace`
that selects among stored credentials. Ours stores a single key (`auth login/status/logout`).
→ Add credential store keyed by workspace slug + `auth list/default/token` + global `--workspace`.

### 2. GitHub PR + commit integration — *high* (for the dev workflow)
Reference `issue pull-request` (`pr`): creates a GH PR with issue title/body, `--base --head
--draft --title --web`. `issue commits` lists commits for an issue (jj). `issue describe` prints
a title + `Fixes ENG-123` trailer for commit messages. `team autolinks` configures GH autolinks.
Ours has none of this. → Highest-leverage differentiator of the reference.

### 3. Linear **agent sessions** — *high (forward-looking)*
Reference `issue agent-session list|view` (filter by status). This is Linear's agent feature;
ours has no coverage. → Worth adding given the direction of the product.

### 4. Status updates (project & initiative) — *medium-high*
Reference `project-update create|list` and `initiative-update create|list`, both with `--health
{onTrack,atRisk,offTrack}` and `--body/--body-file`. Ours can only *list* project updates
(`project updates`), can't create, and has nothing for initiatives. → Add create + the
initiative-update group.

### 5. Bulk operations — *medium*
Reference supports `--bulk <ids...> / --bulk-file / --bulk-stdin` on `issue delete`, `document
delete`, `initiative archive/delete`. Ours is one-at-a-time. → Add a shared bulk helper.

### 6. Markdown rendering, pager, image download — *medium (UX)*
Reference renders issue/project/doc bodies via charmd, auto-pages long output (`--no-pager`), and
downloads inline images (`--no-download`). Ours prints plain text. → Quality-of-life for `view`.

### 7. Richer `issue query` / list filters — *medium*
Reference `issue query`: `--all-teams --search-comments --unassigned --created-after
--updated-after --project-label`, plus `issue mine` with `--web/--app`. Ours `issue list` has
state/assignee/project/label/priority/cycle/query/sort/include-archived but lacks all-teams,
comment search, unassigned, and date-range filters. → Extend our list filters.

### 8. File-upload attachments + `issue attach/link` ergonomics — *medium*
Reference `issue attach <file>` uploads a real file (with `--comment`); `issue link <url>` adds a
URL link. Ours `attachment create` attaches a **URL only** (no file upload). → Add file upload.
(Note: ours additionally has `attachment list/delete`, which the reference lacks.)

### 9. Smaller items
- `schema` command (dump GraphQL SDL/introspection) — easy, niche.
- `team delete` with `--move-issues`, and `team create --private`.
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
- **Dates:** ours `--due`; reference `--due-date`. ours `--target`/`--start`; reference
  `--target-date`/`--start-date`.
- **Assignee "me":** ours accepts `me`; reference accepts `self`/`@me`.

---

## Recommended parity roadmap for `linear-sdk-cli`

If the goal is to match the reference's developer-workflow strength while keeping our broader
coverage, prioritize:

1. **Multi-workspace auth** (`auth list/default/token` + global `--workspace`) — foundational.
2. **GitHub PR + commit workflow** (`issue pr`, `issue describe`, `issue commits`, `team
   autolinks`) — the reference's biggest differentiator.
3. **Status updates** (`project-update`/`initiative-update create` with `--health`).
4. **Bulk ops** (`--bulk/--bulk-file/--bulk-stdin` shared helper).
5. **Agent sessions** (`issue agent-session list/view`) — forward-looking.
6. **UX polish** — markdown rendering + pager + image download on `view`; `-w/--web` / `-a/--app`
   open flags; file-upload attachments.
7. **Filter parity** on `issue list` (`--all-teams`, `--unassigned`, date ranges, comment search).
8. Minor: `schema` dump, `team delete --move-issues`, `--private`, `document --icon/--edit`.

The reverse (porting our notification/webhook/org/favorite/comment-thread/cycle-CRUD coverage to
the reference) is the bigger lift — our resource breadth is the harder thing to replicate.
