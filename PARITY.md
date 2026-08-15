# Feature Parity — `linear-sdk-cli` vs `linear-cli`

This project (`linear-sdk-cli`, `@linear/sdk`-based) compared against the reference CLI
(`linear-cli` v2.1.0, GraphQL-codegen-based — github.com/zhendalf/linear-cli).

_Rewritten 2026-08-12 against source and the live API, after an external audit found the previous
version wrong or stale in ~25 places. **Read the method note at the bottom before editing this
file** — the old version rotted because it was maintained from memory._

## Where the two stand

- **Ours is the stronger base for agents and scripts.** Uniform JSON (lists = bare array, single =
  bare object, errors = `{"error":{message,code}}` on stderr), stable error codes, meaningful exit
  codes, and live discovery (`linear commands --json`, `linear schema`). The reference has no
  equivalent contract — its shapes vary per command and it exits 1 for every handled failure.
- **Theirs is the better terminal tool.** Rendered markdown, a pager, width- and Unicode-aware
  tables, contextual empty states, masked secret input, richer interactive creation.
- **We are broader across the Linear data model**; they are deeper in issue discovery, file
  workflows, portfolio linkage, bulk operations, and VCS integration.
- **Neither is a superset**, and after the 2026-08-12 alignment pass the *dangerous* differences are
  gone: no command spelled the same way now returns different data (see `ALIGNMENT.md`).

## Architecture

| Aspect | Ours | Reference |
|---|---|---|
| API layer | `@linear/sdk` **v89**, with tailored raw GraphQL for list queries | GraphQL codegen against a vendored schema |
| CLI framework | commander 15 | commander |
| Runtime | Bun, raw TS shipped (no build) | Bun, raw TS shipped |
| Binaries | `linear`, `lin` | `linear` |
| Auth | multi-workspace credentials + default | multi-workspace credentials + default |
| Config | user config **and** project `.linear.toml` for non-secret settings (team/workspace/sort/vcs); the API key is **never** read from a project file | `.linear.toml` / `.config/linear.toml`, git-root aware |
| Output | table default, `--json`/`-j` opt-in, `--fields` projection | table default, per-command `-j/--json`, markdown render + pager |
| VCS | git; GitHub PR via `gh`; `issue describe` | git **and jj**; GitHub PR; autolinks; `issue commits` |
| Escape hatch | `api` (query-file, vars-file, paginate, raw) + `schema` dump | `api` + `schema` dump |

**Global flags.** Ours registers `--json/-j --no-color --api-key --workspace -t/--team -n/--limit
--all -f/--fields -y/--yes -q/--quiet --no-input --debug` on every command; a command may now
declare its own version of a global to give it a local meaning (`issue update --team` moves an
issue). The reference declares almost everything per-command. Ours is more uniform but advertises
options some commands ignore — see `AUDIT.md` #8, which is only partly resolved.

## Real gaps in OURS

Verified present in the reference and absent here. Anything reachable through `linear api` is still
listed, because a raw GraphQL call is not an equivalent user-facing capability.

| Gap | Value | Notes |
|---|---|---|
| **File uploads** — `issue attach <file>`, `comment --attach` | Logs, screenshots, artifacts are core terminal/agent inputs | SDK exposes `fileUpload`; needs signed-upload + HTTP PUT. If built, copy their **private-by-default** posture with an explicit `--public` |
| **Agent sessions** — `issue agent-session list/view` | Inspect coding-agent status and activity | SDK has the types; forward-looking |
| **Initiative ↔ project linkage** — `initiative add-project`/`remove-project` | Portfolio workflows | Direct SDK methods |
| **`initiative unarchive`** | Recovery | Direct SDK method |
| **`project delete`** (we only archive) | Archive and trash are different lifecycle steps | Direct SDK method |
| **`team delete`** (with `--move-issues`), **`team create --private`** | Consolidation; visibility at creation | `TeamCreateInput.private` exists |
| **`team autolinks`** | GitHub repo onboarding | Not SDK work — `gh` integration |
| **`issue commits`** + jj support | jj users; commit discovery | Needs a VCS abstraction; jj was explicitly dropped once already |
| **Bulk operations** — `--bulk/--bulk-file/--bulk-stdin` | Generated id sets need one review and partial-failure handling | Loop existing mutations; no SDK blocker |
| **Output ergonomics** — markdown rendering, pager, image download, `-a/--app` | The gap a human notices first | Their `charmd`/pager work is substantial |
| **Document `--icon`, `-e/--edit`, `update --project`**, inline-comment overwrite guard | Metadata preservation and edit safety | Their guard refuses to overwrite a doc carrying active inline comments |
| **Health-only status updates** | A health change should not require inventing prose | SDK permits an empty body; we require one |
| **Richer `issue view`** — children, attachments, documents, threaded comments | Complete work context in one call | Typed SDK fields exist |
| **Project slug resolution**, `--all-teams` on `project list` | URL-derived lookups; configured-team narrowing hides projects | Resolver work |

## Gaps in the REFERENCE (our advantages)

Whole areas it does not cover: **notifications**, **webhooks**, **organization** metadata/invites,
**favorites**, **roadmaps** (deprecated API), **cycle create/update** (it is read-only),
**project archive** and broad project update (content/priority/members/icon/colour),
**comment resolve/unresolve**, **issue subscribe/unsubscribe**, **attachment list/delete**,
**team view/update**, **label update and sub-labels**, **user view/me**, **workflow-state view**,
**initiative priority/labels**, resolved-config readback, `linear commands`/`schema` discovery,
and shell completion.

The audit also found **defects in the reference**: `initiative update` sends invalid lowercase
status enums, `--search` silently drops `--milestone`, and several of its lists issue only one
connection request (no pagination).

## Differences we deliberately keep

Not gaps — choices. Full reasoning in `ALIGNMENT.md`.

- `issue list` stays general; theirs aliases `list` to `mine`. We ship `mine` separately.
- One meaning per short flag. Their tree spells `-t` as both `--title` and `--team`, `-f` four ways.
- `--sort priority` sorts state **ascending** (active work first). Theirs hardcodes descending,
  which the API answers with Backlog above In Progress.
- `--all` is the spelling we teach for unlimited; `--limit 0` is accepted as their synonym.
- Our uniform JSON envelope, rather than their per-command connection shapes.

Their spellings are otherwise accepted as aliases (`--due-date`, `--target-date`, `--start-date`,
`--search`, `--status`, `self`, `issue query`, `auth whoami`, `issue comment <verb>`).

## Method note — how to keep this file honest

The previous version claimed `schema` was reference-only in three places while we shipped
`linear schema`; called cycle support "full CRUD" when archive/delete do not exist; and listed
`user list` and comment `reply` as ours-only when the reference has both. Every one of those came
from editing prose rather than checking.

Before changing anything here:

1. **Regenerate the command diff.** `linear commands --json | jq -r '.[].path' | sort` for ours;
   for theirs, extract `Usage:` lines from `skills/linear-cli/references/*.md` in its repo.
2. **Treat that diff as leads, not findings.** It produces false positives in both directions —
   `issue query` is an *alias* of our `issue list`, and `issue relation add` is a *positional
   operand* here, not a missing subcommand. Both looked like gaps and were not.
3. **Verify against source or the live API**, and say which. A capability that exists under a
   different name, or as a flag on another command, is parity — record where it lives.
4. `AUDIT.md` holds the externally verified capability matrix with `file:line` citations; prefer
   linking to it over restating it here.
