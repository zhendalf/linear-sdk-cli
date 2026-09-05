# linear-sdk-cli

**An ergonomic command-line interface for [Linear](https://linear.app), built on the official
[`@linear/sdk`](https://www.npmjs.com/package/@linear/sdk).**

It's designed to be pleasant for humans _and_ dependable for scripts and agents. By default you
get clean, aligned tables and detail views; add `--json` to any data command for a stable,
machine-readable shape. It's git-aware (the "current issue" comes from your branch name) and
forgiving about input (`--assignee me`, team key `TES`, state and label by name). Anything the
curated commands don't wrap is still reachable through a raw GraphQL escape hatch (`linear api`),
subject to the permissions granted to your Linear credential.

```sh
linear issue list --assignee me --state started   # what's on my plate
linear                                              # the issue for the branch you're on
linear issue list --json | jq -r '.[].identifier'  # ready for scripts
```

> Design influenced by [`schpet/linear-cli`](https://github.com/schpet/linear-cli) (human-first,
> git-aware) and [`linearis`](https://github.com/linearis-oss/linearis) (JSON-first for agents).

## Why this project exists

This project grew from strong ideas in earlier tools, especially the human-first, git-aware
workflow credited above. Four requirements made a separate implementation the better fit for our
use case:

- **A smaller cloud deployment surface.** The reference implementation and its development path
  centered on the full Deno runtime. Carrying that runtime into our cloud environments was more
  infrastructure than the CLI warranted. This package ships its TypeScript source directly and
  reuses the Bun runtime already present in our environment instead of packaging another runtime
  for one tool. Later prebuilt releases moved that runtime into the artifact rather than
  eliminating its footprint: for example, the
  [v2.5.0 macOS ARM build](https://github.com/schpet/linear-cli/releases/tag/v2.5.0) expands to a
  146 MB executable. Avoiding a heavyweight per-tool binary keeps cloud images and ephemeral agent
  environments simpler and smaller.
- **Lower invocation overhead for agent loops.** An interactive CLI may start once; an agent can
  start it dozens or hundreds of times while completing one workflow, so even modest cold-start
  latency compounds. A public
  [startup-time report](https://github.com/schpet/linear-cli/issues/261) documented the difference
  against a compiled alternative and identified repeated agent calls as the motivating case. The
  Bun-first implementation makes process startup a product constraint and reduces that recurring
  overhead in our deployment model.
- **Alignment with Linear's official SDK.** The CLI is built directly on `@linear/sdk` and follows
  its release cycle. Linear's SDK remains the source of truth for the API model, generated types,
  connections, and transport; this project can focus on command design and stable output instead
  of recreating official API machinery. A coverage audit catches additions, removals, and
  classification drift among the SDK client's top-level members.
- **Agent-native development and maintenance.** This project was built from scratch by coding
  agents, and agents continue to implement features, update dependencies, regenerate
  documentation, run verification, and prepare maintenance and release work. Versioned maintenance
  policy, CI, coverage checks, and release automation provide the guardrails that make that model
  repeatable rather than ad hoc.

Together, those requirements made `linear-sdk-cli` the default for our deployments and automation
workflows. That is a statement about fit, not a claim that earlier tools are obsolete; this CLI
retains their best ideas and provides a careful compatibility and migration path.

## Highlights

- **Human-first by default** — aligned tables, rendered Markdown, safe paging for long detail,
  color controls, and a clear notice when a list was truncated.
- **Agent- and script-friendly** — every data command takes `--json` and emits a stable, documented envelope on stdout; status text stays on stderr.
- **Git-aware** — the current issue is inferred from your branch (`tes-123-fix` → `TES-123`), so most issue commands let you drop the id.
- **Git + GitHub workflow** — `issue start` checks out the branch and marks the issue started, `issue describe` prints a commit message with Linear-issue trailers, `issue pr` opens a GitHub PR — all linked back to the issue.
- **Forgiving inputs** — refer to things the way you think of them: `TES-123`, team `TES`, `--assignee me`, `--cycle current`, state and label by name.
- **Multi-workspace** — store credentials and a non-secret default team per workspace, then switch
  both contexts with a global `--workspace`.
- **Complete & honest** — first-class commands for the core resource graph, a raw `linear api` for everything else, and a [measured coverage audit](#coverage) that CI keeps honest.

## Install

Requires [Bun](https://bun.sh) **1.1 or newer**. Authenticate with browser OAuth (the default), an
invocation-scoped OAuth access token, or a personal API key. The CLI ships as TypeScript and runs
directly on Bun — no build step, no bundle, no Node.

```sh
bun add --global linear-sdk-cli
lin --help
```

This installs two equivalent binaries: **`linear`** and the shorter **`lin`**. If you already
have a different tool named `linear` on your `PATH`, just use `lin`.

### Existing `linear` installations

Another CLI may already provide a binary named `linear`; whichever appears first on `PATH` wins.
Use this package's collision-free **`lin`** alias while evaluating or migrating. See
[`MIGRATING.md`](MIGRATING.md) for side-by-side installation, credential and config compatibility,
and the few commands whose behavior intentionally differs.

<details>
<summary>Run from source instead</summary>

```sh
git clone https://github.com/zhendalf/linear-sdk-cli.git && cd linear-sdk-cli
bun install
bun run src/bin/linear.ts --help     # or: bun run dev -- --help
```

</details>

## Quickstart

```sh
linear auth login                          # browser OAuth; or set LINEAR_API_KEY
linear whoami                              # confirm you're connected

linear issue list --assignee me --state started        # my in-progress work
linear issue view TES-42                                # full detail
linear issue create --title "Fix login" --team TES -P 2 # new High-priority issue
linear issue start TES-42                               # check out its branch + mark it started
linear issue comment TES-42 "shipped — please review"
```

In a git repository, bare `linear` (and `linear issue`) shows the issue inferred from the current
branch, so most issue commands let you omit the id entirely.

## Authentication

For a person at a terminal, `linear auth login` uses browser Authorization Code + PKCE and the
default `actor=user`. Existing personal API keys and invocation-scoped OAuth access tokens remain
supported. Explicit `--api-key` or `--access-token` flags override environment credentials;
without a credential flag the CLI reads `LINEAR_API_KEY` or `LINEAR_ACCESS_TOKEN`. If both kinds
are supplied at the same precedence level, the CLI fails rather than silently choosing a Linear
actor.

> **Credential trust boundary.** A secret is **never** read from a project-local
> `.linear.toml` — only non-secret settings live there — so a key can't be committed by accident.
> A project may select one of your already-stored credentials with `workspace = "<slug>"`, but it
> cannot provide or override the secret. Browser OAuth credentials are keyring-only; an access
> token injected with `--access-token` or `LINEAR_ACCESS_TOKEN` remains invocation-scoped.

```sh
linear auth login                          # browser OAuth, read + write, actor=user
linear auth login --read-only              # request only Linear's read scope
linear auth login --no-browser             # print the URL; still waits on the loopback callback
printf '%s\n' "$LINEAR_API_KEY" | linear auth login --key -  # personal API-key fallback
linear auth status                         # credential kind and source (value redacted)
linear auth logout --workspace acme        # revoke OAuth (if used) and remove the profile
```

Browser login generates a cryptographically random verifier and CSRF state, requires PKCE S256,
opens Linear, and listens temporarily on the registered `127.0.0.1` callback. It validates the
viewer and workspace before saving the access token, rotating refresh token, expiry, granted
scopes, OAuth client identity, and workspace identity. The whole record lives only in the system
keyring (`service = linear-cli`, `account = oauth:<workspace slug>`); the config file gets only
non-secret `keyring = true` and `oauth = true` markers. Access tokens refresh before expiry and
once after an authentication failure, with refresh-token rotation committed under the credential
store lock. `--admin` explicitly adds the admin scope; it is never implicit.

`--no-browser` is useful over SSH only when the machine running the CLI is also reachable as the
browser's loopback host; Linear does not currently document a device-code flow. Override a
separately registered public client's identity with `LINEAR_OAUTH_CLIENT_ID` and its exact callback
with `LINEAR_OAUTH_REDIRECT_URI`. No OAuth client secret is embedded, accepted, or stored.

For a personal API key, `auth login --key -` reads stdin, validates the viewer/workspace, stores the
key in the system keyring by default, and writes only a marker to the config. `--plaintext` is an
API-key-only compatibility option. API-key entries use `account = <workspace slug>`, preserving
compatibility with existing keyring profiles. Passing a key as `--key <value>` works but warns
because argv is visible to other processes. `auth migrate` moves legacy plaintext keys into the
keyring, and `auth token` exports stored API keys only; OAuth tokens are never printed.

### Apps, agents, and service accounts

Use an OAuth access token when the CLI runs inside an integration or agent:

```sh
LINEAR_ACCESS_TOKEN="$access_token" linear whoami --json
LINEAR_ACCESS_TOKEN="$access_token" linear issue list --json
```

The application host owns OAuth installation, refresh-token or client-credentials exchange,
client-secret storage, and webhook processing; it injects only the current access token into each
CLI invocation. The CLI passes it to `LinearClient({ accessToken })`, which sends the required
Bearer authorization. Prefer the environment variable because a command-line token is visible to
other processes and shell history.

For a long-lived, single-workspace host, enable client credentials on the Linear OAuth app and keep
its client ID and secret in the host's secret manager. The package exports an expiry-aware provider
that caches Linear's 30-day app-actor token in memory, coalesces concurrent exchanges, renews five
minutes before expiry, and can be forced to renew after a `401`:

```ts
import { ClientCredentialsTokenProvider } from "linear-sdk-cli";

const { LINEAR_CLIENT_ID: clientId, LINEAR_CLIENT_SECRET: clientSecret, ...childEnv } = process.env;
if (!clientId || !clientSecret) throw new Error("Linear OAuth credentials are missing");

const tokens = new ClientCredentialsTokenProvider({
  clientId,
  clientSecret,
  scopes: ["read", "write"],
});

const { accessToken } = await tokens.getAccessToken();
const child = Bun.spawn(["linear", "issue", "list", "--json"], {
  env: { ...childEnv, LINEAR_ACCESS_TOKEN: accessToken },
});
await child.exited;
```

Call `tokens.invalidate()` (or `getAccessToken({ forceRefresh: true })`) before one bounded retry
when Linear rejects the token with `401`. Client-credentials tokens do not have refresh tokens;
renewal is another authenticated exchange. A short-lived/serverless process should use a secure
shared token cache or central broker rather than minting a new 30-day token on every invocation.

For an app installed into multiple workspaces, use Authorization Code with `actor=app` instead and
store each installation's rotating refresh token encrypted in the host. That hosted app lifecycle
remains distinct from this CLI's browser PKCE login for a human `actor=user`.

For a distinct app identity, install the OAuth application with `actor=app`. Native Linear agents
can additionally request `app:mentionable` and `app:assignable` and subscribe to Agent Session
webhooks. App actors cannot request the `admin` scope. See Linear's
[OAuth guide](https://linear.app/developers/oauth-2-0-authentication),
[app-actor authorization](https://linear.app/developers/oauth-actor-authorization), and
[agent guide](https://linear.app/developers/agents).

Hosted app tokens supplied through `LINEAR_ACCESS_TOKEN` remain invocation-scoped. The only OAuth
tokens persisted by the CLI are human browser-login sessions, stored as an isolated per-workspace
keyring record; the CLI never persists or uses an OAuth client secret.

### Multiple workspaces

Credentials are stored per **workspace slug**. Browser and API-key login both derive the slug from
the authenticated organization; `--workspace` validates that the result matches:

```sh
linear auth login --workspace acme         # browser OAuth for "acme"
linear auth login --workspace other-org    # …and another workspace
linear auth login --workspace acme --key - # personal API-key fallback via stdin
linear auth list                           # show configured workspaces + which is default
linear auth default acme                   # choose the default workspace
linear config set team ENG --user --workspace acme # set its validated default team
linear --workspace other-org issue list    # use a specific workspace for one command
linear auth logout --workspace acme        # revoke OAuth, then remove one credential
```

Successful browser and API-key login also save `workspace = "<authenticated slug>"` in the discovered project config, preserving other settings and comments. If no config exists, login creates `.linear.toml` at the Git root (or cwd outside Git). Use `auth login --no-project` for credential-only login. Human output reports the association path; JSON includes `projectConfigPath` (null with `--no-project`). Credentials remain in the global credential store. Environment overrides still take precedence over this association.

Global defaults are optional: login, credential adoption, and logout never choose a new one. Use `linear auth default <slug>` to explicitly select a global fallback. Removing that workspace clears its default without promoting another workspace. Existing defaults, including defaults imported from the reference CLI, are preserved on upgrade because older files cannot distinguish a user choice from an automatically assigned default. To opt out of a legacy default, remove the top-level `default_workspace` from the user config and, if present, `default` from the reference CLI's `credentials.toml`; retain the workspace entries.

If revocation is intentionally unavailable, `auth logout --local-only` removes only local state.
If browser login temporarily superseded an existing personal API-key profile for that workspace,
OAuth logout preserves and reactivates the API key instead of deleting it.

**Selection precedence** (strict): an explicit `--api-key` or `--access-token` flag bypasses the
environment and stored-credential lookup. Otherwise `LINEAR_API_KEY` or `LINEAR_ACCESS_TOKEN` is
absolute. With no invocation-scoped credential, the workspace is chosen by `--workspace` →
`LINEAR_WORKSPACE` env → project config `workspace` → `default_workspace` in the user config. With
one configured workspace it's used automatically; with several and no selection, interactive
commands prompt for an invocation-only choice. Noninteractive and JSON commands fail clearly
and explain how to select a workspace. Auth repair and discovery commands remain available. An invocation credential does not
silently inherit the default or project profile's team; pair it with `--workspace` (or
`LINEAR_WORKSPACE`) naming a configured profile when that profile metadata should apply.

## Core concepts

A few ideas run through every command:

- **Git-branch awareness.** On a `tes-123-*` branch, bare `linear` shows `TES-123` (identical to
  `issue view TES-123`), and nearly every issue subcommand infers the id from the branch — so
  `linear issue comment "…"`, `linear issue start`, `linear issue pr` all "just work" in context.
- **Human by default, `--json` for machines.** Without `--json` you get tables and detail views
  meant to be read. With `--json`, stdout carries _only_ machine JSON (a [stable
  envelope](#scripting--agents)); status and progress always go to stderr.
- **Forgiving inputs.** Resolve things by how you think about them: `--assignee me`, assignee by
  email or name, team key `TES`, `--cycle current`, workflow state and label by name (case-
  insensitively). Ambiguous names produce a clear error (exit `3`), not a wrong guess.

## Common workflows

**Issue lifecycle**

```sh
linear issue create --title "Fix login redirect" --team TES -P 2 --assignee me
linear issue list --assignee me --state started
linear issue update TES-42 --state "In Review" --add-label backend
linear issue label TES-42 --set-group 'Team=QA'
linear issue delegate TES-42 Codex
linear issue comment TES-42 "ready for another look"
linear issue archive TES-42 --yes
```

**Agent delegation (Developer Preview)** — the assignee remains the human owner; the delegate is
the agent working on their behalf. Create/update accept `--delegate <name|id>` and
`--clear-delegate`; the focused command is convenient on a matching branch:

```sh
linear issue create --title "Investigate flaky CI" --assignee me --delegate Codex
linear issue update TES-42 --delegate Codex
linear issue update TES-42 --clear-delegate
linear issue delegate TES-42 Codex
linear issue delegate --clear                    # issue inferred from the branch
linear issue delegate TES-42 Codex --dry-run --json
linear issue delegate TES-42 Codex --full-result --json
```

Delegate resolution accepts an agent-user UUID, exact display name, or exact full name, preferring
case-sensitive matches. It rejects human, inactive, non-assignable, ambiguous, and team-ineligible
users before writing. `--dry-run` resolves every field and prints the exact nullable `delegateId`
input without a mutation; `--full-result` (hidden alias `--read-back`) returns the relationship
receipt plus the canonical issue read-back and verifies the resulting delegate. These modes are
currently the delegation slice only: on `issue create`/`update`, pair them with `--delegate` or
`--clear-delegate`.

Delegating can trigger an externally observable Agent Session/webhook. Clearing a delegate does
not claim to cancel a session that is already running. Linear for Agents is in Developer Preview;
an unsupported workspace/schema returns `feature_not_accessible`, while ordinary `issue view`
falls back safely and reports `delegate: null` if the preview field itself is unavailable.
See Linear's current [agent integration guide](https://linear.app/developers/agents) and
[issue-assignment guide](https://linear.app/docs/assigning-issues) for the platform semantics.

**Label-group replacement** — replace only the selected group's direct member while preserving
every unrelated issue label. Repeat `--set-group` to plan several groups into one relative-label
mutation:

```sh
linear issue label TES-42 --set-group 'Team=QA'
linear issue label TES-42 \
  --set-group 'Team=QA' \
  --set-group 'Issue Type=Bug' \
  --json
linear issue label TES-42 --set-group 'Team=QA' --dry-run --json
linear issue label TES-42 --set-group 'Team=QA' --full-result --json
```

Both sides accept a UUID or an exact, case-sensitive name. The value is split on the first `=`:
shell-quote the whole assignment when either name contains spaces or shell metacharacters; a label
name may contain additional `=` characters without escaping. If the group name itself contains
`=`, use its UUID on the left. Group containers, archived labels, labels outside the issue team's
workspace/team/inherited scope, and labels that are not direct members of the named group are
rejected before writing. Repeating an identical assignment normalizes to one operation; conflicting
targets for the same resolved group are a usage error. `--set-group` cannot be mixed with the
existing `--add`/`--remove` mode.

The JSON receipt includes the resolved group/member IDs plus `changed` and `mutationSent`. An
already-satisfied request succeeds with both fields `false` and sends no mutation. `--dry-run`
returns the shared mutation-plan envelope and the exact `addedLabelIds`/`removedLabelIds` input;
`--full-result` adds the canonical issue read-back, verification, and each requested group's prior
members (including all members repaired from an inconsistent pre-existing state).

This is a read/modify/write operation: the CLI reads the current labels, then sends one update with
relative added/removed IDs, so unrelated concurrent label changes are not overwritten. Linear does
not expose a compare-and-swap precondition here, so another writer changing the same group between
the read and update can race; use `--full-result` when post-write verification matters. See Linear's
current [label documentation](https://linear.app/docs/labels) for group and inheritance semantics.

**Git + GitHub PR** — turn an issue into commits and a pull request. The id is inferred from the
branch everywhere below.

```sh
linear issue start TES-123                 # checkout tes-123-* branch and mark it started (--no-move: branch only)
git commit -m "$(linear issue describe)"   # "TES-123 Title" + Linear-issue trailers
linear issue pr                             # open a GitHub PR titled "TES-123 Title", body = the trailers
linear issue pr --draft --base main        # …as a draft against a specific base
linear issue pr --json | jq -r .url        # the created PR URL is the only thing on stdout
```

`issue describe` prints a whole commit message — `TES-123 Title`, a blank line, then two git
trailers, `Linear-issue: Fixes TES-123` and `Linear-issue-url: <url>` (compatible with existing
workflows, so `git interpret-trailers` and jj read it back). The magic word sits
right before the id, which is where Linear's
[git integration](https://linear.app/docs/github#link-prs-and-commits) reads it, so the issue is
linked — and closed on merge — when the commit lands; `-r` swaps in `References` to link without
closing. `issue pull-request` (alias `pr`) opens the PR via the [`gh`](https://cli.github.com) CLI:
title `TES-123 Title` (a custom `--title` is prefixed the same way), body the same two trailers,
so the PR and issue reference each other; the issue description stays in Linear. It never pushes
or creates branches for you, and fails with a clear error (not a stack trace) when `gh` is
missing, unauthenticated, or the branch isn't pushed.

**Comments & explicit mentions** — ordinary `@name` text stays literal and never notifies anyone.
Use repeatable `--mention <name|email|me|id>` when a real Linear mention is intentional; the CLI
resolves each user exactly, deduplicates repeats, and prepends the mentions as their own Markdown
paragraph. The flag works on `issue comment`, `comment add`, `comment reply`, and `comment update`
(including the `issue comment add/update` aliases).

```sh
linear issue comment TES-123 "Please review this." --mention ada
linear comment add TES-123 --mention ada --mention grace --body-file - <<'EOF'
The migration plan is ready for review.
EOF
```

**Projects & status updates**

```sh
linear project list --team TES
linear project list --include-archived --all --json
linear project view "Q3 Launch"
linear initiative list --include-archived --json
linear project-update create "Q3 Launch" --health onTrack --body "Beta is out to 10% of users."
linear initiative-update create "Platform" --health atRisk --body-file update.md
```

Status updates (`project-update`/`pu`, `initiative-update`/`iu`) take the body from `--body`,
`--body-file <path>` (`-` for stdin), or `--editor` (`$EDITOR`), plus an optional
`--health <onTrack|atRisk|offTrack>`.

**Custom views** — create and inspect saved Issue, Project, and Initiative filters without writing
GraphQL. A filter is the current Linear `IssueFilter`, `ProjectFilter`, or `InitiativeFilter` JSON
object; pass it inline or from a file/stdin. The selected `--type` decides which typed SDK input
field receives it, and an omitted filter becomes `{}` so the view type still round-trips.

```sh
linear custom-view list
linear cv create --name "Urgent" --type issue \
  --filter '{"priority":{"eq":1}}' --shared
linear cv view 01234567-89ab-cdef-0123-456789abcdef
linear cv results 01234567-89ab-cdef-0123-456789abcdef --all
linear cv update 01234567-89ab-cdef-0123-456789abcdef \
  --filter-file issue-filter.json --personal
linear cv delete 01234567-89ab-cdef-0123-456789abcdef --yes
```

Create can attach a view with one of `--scope-team`, `--scope-project`, or `--scope-initiative`.
Linear marks project/initiative scope fields internal on update, so update exposes only the public
team scope (`--scope-team` / `--clear-team-scope`) and never rewrites an unspecified scope. View
references are UUID-only: names are not unique, and Linear's `customViews` query intentionally
omits project- and initiative-scoped views. Those scoped views remain accessible by UUID. Initiative
views require an eligible Linear plan.

```sh
linear cv list --json | jq -r '.[] | [.id, .name, .type] | @tsv'
linear cv results 01234567-89ab-cdef-0123-456789abcdef --json
# [{"type":"issue","id":"…","identifier":"ENG-42","name":"Fix login","url":"…"}]
```

## Command overview

Every group has `--help` with full options and (for the busy ones) an Examples section. Aliases
are shown in parentheses. For a machine-readable tree of _every_ command, run
`linear commands --json`.

| Group                          | What you can do                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`issue`** (`i`)              | `view` · `list` · `mine` · `search` · `create` · `update` · `delete` · `archive`/`unarchive` · `start` (git branch) · `describe` · `pull-request`/`pr` · `assign` · `delegate` · `state` · `label` · `comment`/`comments` · `relation` · `subscribe`/`unsubscribe` · `id`/`title`/`url`/`branch` |
| **`team`** (`t`)               | `list` · `view` · `members` · `states` · `labels` · `cycles` · `create` · `update`                                                                                                                                                                                                               |
| **`project`** (`p`)            | `list` · `view` · `create` · `update` · `archive` · `milestones`                                                                                                                                                                                                                                 |
| **`project-update`** (`pu`)    | `create` · `list` (project status updates, with `--health`)                                                                                                                                                                                                                                      |
| **`milestone`** (`m`)          | `list` · `view` · `create` · `update` · `delete`                                                                                                                                                                                                                                                 |
| **`cycle`** (`c`)              | `list` · `view` · `current` · `create` · `update`                                                                                                                                                                                                                                                |
| **`user`** (`u`)               | `list` · `view` · `me`                                                                                                                                                                                                                                                                           |
| **`label`** (`lb`)             | `list` · `create` · `update` · `delete`                                                                                                                                                                                                                                                          |
| **`state`** (`st`)             | `list` · `view` (workflow states)                                                                                                                                                                                                                                                                |
| **`comment`** (`cm`)           | `list` · `add` · `reply` · `update` · `delete` · `resolve`/`unresolve`                                                                                                                                                                                                                           |
| **`document`** (`doc`)         | `list` · `view` · `create` · `update` · `delete`                                                                                                                                                                                                                                                 |
| **`attachment`** (`at`)        | `list` · `create` · `delete`                                                                                                                                                                                                                                                                     |
| **`favorite`** (`fav`)         | `list` · `add` · `remove`                                                                                                                                                                                                                                                                        |
| **`custom-view`** (`cv`)       | `list` · `view` · `results` · `create` · `update` · `delete`                                                                                                                                                                                                                                     |
| **`initiative`** (`init`)      | `list` · `view` · `create` · `update` · `archive` · `delete`                                                                                                                                                                                                                                     |
| **`initiative-update`** (`iu`) | `create` · `list` (initiative status updates, with `--health`)                                                                                                                                                                                                                                   |
| **`roadmap`** (`rm`)           | `list` · `view` · `create` · `update` · `delete` &nbsp;<sup>†</sup>                                                                                                                                                                                                                              |
| **`notification`** (`notif`)   | `list` · `read`/`unread` · `read-all` · `archive` · `snooze`                                                                                                                                                                                                                                     |
| **`organization`** (`org`)     | `view` · `members` · `invites`                                                                                                                                                                                                                                                                   |
| **`webhook`** (`wh`)           | `list` · `view` · `create` · `update` · `delete`                                                                                                                                                                                                                                                 |
| **top-level**                  | `whoami` · `auth` (`login` · `list` · `default` · `token` · `status` · `logout`) · `config` · `api` · `commands` · `schema` · `completion`                                                                                                                                                       |

<sup>†</sup> Linear has **deprecated roadmaps** in favor of initiatives — reads still work, but the
API rejects roadmap mutations with a deprecation notice. Use `initiative` for new work.

### Archived resources

Linear hides archived resources from paginated connections by default. On curated listings that
expose lifecycle history, `--include-archived` widens the result to live plus historical records;
it is not an archived-only filter. Linear can return trashed resources in that widened set, so
project, initiative, and issue JSON rows expose both `archivedAt: string|null` and
`trashed: boolean`, and human tables label `(archived)` and `(trashed)` separately. Notification
rows expose `archivedAt` (the public schema has no `trashed` field for notifications).

`--all` remains pagination-only. The two flags are independent and composable:

```sh
linear project list --include-archived --all --json
linear initiative list --include-archived --status Completed --json
linear issue search "migration" --include-archived --all --json
```

`initiative list --archived` remains a compatibility alias for `--include-archived`; passing both
spellings is an explicit usage error. The alias is retained for the current compatibility window
(all `0.x` releases; removal no earlier than `1.0`) and is listed by help and
`linear commands --json`.

The following matrix audits every curated list/search surface against the installed
`@linear/sdk@92.0.0` types and the live public schema exposed by `linear schema`. “Schema support”
means that the exact connection used by the command accepts `includeArchived`; it does not by
itself add a CLI contract. This change standardizes the four resource families named by
the issue. The remaining schema-capable collections stay unchanged until their own output and
resolver semantics are designed, rather than acquiring a silent partial implementation.

| Curated command(s)                                     | Connection audited                            | Schema support | CLI lifecycle option                           | Lifecycle fields in list JSON |
| ------------------------------------------------------ | --------------------------------------------- | -------------- | ---------------------------------------------- | ----------------------------- |
| `issue list`, `issue mine`                             | `Query.issues`                                | yes            | `--include-archived`                           | `archivedAt`, `trashed`       |
| `issue search`                                         | `Query.searchIssues`                          | yes            | `--include-archived`                           | `archivedAt`, `trashed`       |
| `project list`                                         | `Query.projects`                              | yes            | `--include-archived`                           | `archivedAt`, `trashed`       |
| `initiative list`                                      | `Query.initiatives`                           | yes            | `--include-archived` (`--archived` alias)      | `archivedAt`, `trashed`       |
| `notification list`                                    | `Query.notifications`                         | yes            | `--include-archived`                           | `archivedAt`                  |
| `attachment list`                                      | `Issue.attachments`                           | yes            | not exposed                                    | not exposed                   |
| `comment list`, `issue comment list`, `issue comments` | `Issue.comments`                              | yes            | not exposed                                    | not exposed                   |
| `cycle list`, `team cycles`                            | `Team.cycles`                                 | yes            | not exposed                                    | not exposed                   |
| `custom-view list`                                     | `Query.customViews`                           | yes            | not exposed                                    | `archivedAt`                  |
| `custom-view results`                                  | `CustomView.issues/projects/initiatives`      | yes            | not exposed                                    | not exposed                   |
| `document list`                                        | `Query.documents`                             | yes            | not exposed                                    | not exposed                   |
| `favorite list`                                        | `Query.favorites`                             | yes            | not exposed                                    | not exposed                   |
| `initiative-update list`                               | `Initiative.initiativeUpdates`                | yes            | not exposed                                    | not exposed                   |
| `issue agent-session list`                             | `Query.agentSessions` / `Issue.agentSessions` | yes            | not exposed                                    | not exposed                   |
| `label list`, `team labels`                            | `Query.issueLabels` / `Team.labels`           | yes            | not exposed                                    | not exposed                   |
| `milestone list`, `project milestones`                 | `Project.projectMilestones`                   | yes            | not exposed                                    | not exposed                   |
| `project-update list`                                  | `Project.projectUpdates`                      | yes            | not exposed                                    | not exposed                   |
| `roadmap list`                                         | `Query.roadmaps`                              | yes            | not exposed                                    | not exposed                   |
| `state list`, `team states`                            | `Team.states`                                 | yes            | not exposed                                    | not exposed                   |
| `team list`                                            | `Query.teams`                                 | yes            | not exposed                                    | not exposed                   |
| `team members`, `user list`, `organization members`    | user connections                              | yes            | not exposed (`--include-disabled` is separate) | not exposed                   |
| `organization invites`                                 | `Query.organizationInvites`                   | yes            | not exposed                                    | not exposed                   |
| `webhook list`                                         | `Query.webhooks`                              | yes            | not exposed                                    | not exposed                   |
| `auth list`                                            | local credential registry (no API connection) | no             | not applicable                                 | not applicable                |

### Global flags

| Flag                        | Effect                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `--json`                    | Emit machine JSON only on stdout (see [the contract](#scripting--agents)).                                                |
| `-f, --fields a,b,c`        | Choose which columns to show (table output), detail lines, or JSON keys. Refused on a command that prints only a receipt. |
| `-n, --limit <n>` / `--all` | Cap results, or fetch every page. Refused on a command that pages nothing.                                                |
| `-t, --team <key>`          | Set the default team for the command.                                                                                     |
| `--workspace <slug>`        | Select which stored workspace credential to use.                                                                          |
| `-y, --yes`                 | Skip confirmation prompts (required for destructive actions when not a TTY).                                              |
| `--no-input`                | Never prompt; fail with a usage error instead of hanging.                                                                 |
| `--no-ansi`                 | Disable colored output (`--no-color` is accepted as an alias).                                                            |
| `-q, --quiet` · `--debug`   | Silence status output · verbose errors.                                                                                   |

## Scripting & agents

The CLI is built to be driven by scripts and agents. Everything in this section is a stable
contract.

**The `--json` envelope.** With `--json`, stdout carries _only_ machine JSON, pretty-printed, one
value per command:

- **list** commands emit a **bare array** (`[...]`) — even when empty (`[]`) and even for a single result.
- **single-resource** commands (`view`, `whoami`, …) emit a **bare object** (`{...}`).
- **mutations** (`create`/`update`/`delete`/`archive`/…) emit the affected object — typically a
  small shape like `{ "id", "identifier", "url" }`, or `{ "id", "success": true }` when the API
  returns no body. Destructive commands add a flag such as `{ "deleted": true }` / `{ "archived": true }`.
- **errors** go to **stderr** as `{"error":{"message":"…","code":"…"}}` and never to stdout. With
  `--debug`, the extra detail is carried _inside_ that object as `error.detail` rather than appended
  after it, so `--json --debug` output stays parseable.

Status, progress, and pagination notes always go to **stderr**, so `cmd --json` is safe to pipe
into `jq` unconditionally:

```sh
linear issue list --json | jq -r '.[].identifier'
linear issue view TES-42 --json | jq -r '.url'
ID=$(linear issue create --title "Fix" --team TES --json | jq -r '.id')
```

**Exit codes** are stable and distinct, so a script can branch on the failure class:

| Code | Name                | When                                                                |
| ---: | ------------------- | ------------------------------------------------------------------- |
|  `0` | ok                  | success                                                             |
|  `1` | runtime/API         | network/GraphQL/other runtime failure (also feature-not-accessible) |
|  `2` | usage               | bad flags/arguments, missing required input, validation             |
|  `3` | not-found/ambiguous | the referenced resource doesn't exist, or a name matched many       |
|  `4` | auth                | missing/invalid API key, or forbidden                               |
|  `5` | rate-limited        | Linear rate limit hit                                               |
|  `6` | cancelled           | a confirmation prompt was declined — nothing was changed            |

The error `code` field in the JSON envelope is one of: `usage`, `auth`, `not_found`, `ambiguous`,
`forbidden`, `validation`, `rate_limited`, `network`, `feature_not_accessible`, `api`, `runtime`.
Several map to the same exit code (e.g. `ambiguous` → `3`, `validation` → `2`, `forbidden` → `4`),
so prefer the `code` field for fine-grained handling and the exit code for coarse branching.

**Non-interactive flags** make runs deterministic in CI and agent loops:

- **`--no-input`** — never prompt; anything that would be prompted for becomes a usage error
  (exit `2`) instead of hanging. Use this whenever there's no human at the keyboard. **`--json`
  implies this**, as does a stdout that is not a TTY: a prompt inside a pipeline is a hang, not a
  question, so you never have to remember both flags.
- **`-y, --yes`** — pre-confirm destructive actions (`delete`/`archive`). Without a TTY,
  destructive commands _require_ `--yes` (they refuse rather than block). If a human declines the
  prompt, the command exits **`6`** and reports `{"cancelled": true, "action": "…"}` under `--json`
  — never `0`, so `linear issue delete X && …` cannot run the `&&` side after a "no".
- **`-q, --quiet`** — suppress success/status lines on stderr (errors still print).
- **`-n, --limit <n>` / `--all`** — `--limit` caps results; `--all` exhausts pagination. With
  neither, the default cap is **50**. `--all` (and very large `--limit`) can be slow and
  rate-limit-prone on big workspaces. It never includes archived resources; combine it with
  `--include-archived` where that option is available.

```sh
# agent-safe: no prompts, no chatter, fail fast with a parseable error
linear issue delete TES-42 --yes --no-input --quiet --json
```

**Discovery — learn the surface without scraping `--help`:**

- **`linear commands --json`** — a bare array of `{ path, description, aliases, arguments, options }`
  for every (sub)command, so an agent can enumerate what's available and how to call it.
- **`linear schema`** — the Linear GraphQL schema as SDL (`-o, --output <file>` writes to a file;
  `--json` prints raw introspection). Pair it with `linear api` to reach anything the curated
  commands don't wrap.

```sh
linear commands --json | jq -r '.[].path'      # every command path
linear schema -o /tmp/linear.graphql            # dump SDL, then explore
grep 'type Issue ' /tmp/linear.graphql
```

**File-based bodies & stdin.** Long text (issue descriptions, comments, status updates) can come
from a file or stdin instead of a flag — e.g. `--body-file <path>` with `-` for stdin, or
`--editor` to open `$EDITOR`. The raw `linear api` reads from `--query-file -` and `--vars-file -`
too, so you can pipe GraphQL straight in. Inline bodies containing literal `\n` sequences are
rejected with this guidance: ordinary shell quotes do not convert them into line breaks.
Literal `@name` text is also preserved. To create a notification-capable Linear mention, pass the
repeatable `--mention <name|email|me|id>` option on a comment-writing command.

**Agent skills.** This repo ships portable agent skills in `skills/`: `linear-sdk-cli` teaches an
agent to drive the CLI, while `linear-sdk-cli-maintenance` defines the repository's safe upkeep
and release-handoff contract. Both use `SKILL.md` so one source works with Codex and Claude Code.
Claude Code receives both skills when the repository plugin is installed:

```bash
# Claude Code — as a plugin (the repo is its own marketplace)
claude plugin marketplace add <owner>/linear-sdk-cli
claude plugin install linear-sdk-cli

# from a clone or install, make a portable SKILL.md available to an agent:
ln -s "$PWD/skills/linear-sdk-cli" ~/.claude/skills/linear-sdk-cli
```

For Codex, install or link the same directory into its skills location; no forked prompt is
needed. The scheduled Claude Code maintenance routine invokes
`skills/linear-sdk-cli-maintenance/SKILL.md` directly, keeping its schedule separate from the
versioned maintenance policy. See [`skills/README.md`](skills/README.md) for the interoperability
contract.

The CLI skill is self-contained: an agent that has only the skill and no CLI is told to
`bun add -g linear-sdk-cli`, and a migrating user is told to check `linear auth status` before
re-entering a key because compatible credentials are discovered automatically. `linear commands
--json` gives it the full command surface at runtime, so the reference docs are a starting point,
not a cage.

## Coming from linear-cli

> The full guide — install without a collision, credentials found without a re-login, config
> compatibility, and the places where behavior intentionally differs — is
> [`MIGRATING.md`](MIGRATING.md). This section is the flag-level cheat sheet.

If your fingers or your scripts learned the other `linear-cli`, most of its spellings work here
unchanged. The left column is theirs, the right is the canonical one this CLI documents and prints
in `--help`; both are accepted, and passing both at once is a usage error rather than a silent pick.

| linear-cli                                | here                   | where                                              |
| ----------------------------------------- | ---------------------- | -------------------------------------------------- |
| `-j, --json`                              | same                   | every command (global)                             |
| `-w, --web`                               | same                   | `issue view`, `issue pull-request`                 |
| `--due-date`                              | `--due`                | `issue create`, `issue update`                     |
| `--target-date`                           | `--target`             | `project`/`milestone`/`initiative` create & update |
| `--start-date`                            | `--start`              | `project create`, `project update`                 |
| `--search`                                | `--query`              | `issue list`, `issue mine`                         |
| `--status`                                | `--state`              | `project list`                                     |
| `--all-states`                            | (no-op)                | `issue list` — it already spans every state        |
| `--limit 0`                               | `--all`                | every list; `--all` is the spelling we teach       |
| `--assignee self`                         | `me` / `@me`           | anywhere a user is named                           |
| `--cycle active`                          | `current`              | anywhere a cycle is named                          |
| `--cycle "<name>"`                        | number, name, or id    | all three resolve                                  |
| `issue query`                             | `issue list`           | same command                                       |
| `auth whoami`                             | `whoami`               | both spellings registered                          |
| `issue comment add\|list\|update\|delete` | `comment add\|list\|…` | both mounted on one implementation                 |

Their query filters all exist here too, under the same names — `issue list`, `issue mine` and
`issue search` share one filter set:

| linear-cli                           | here                | notes                                                                                                                                                           |
| ------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-U, --unassigned`                   | same                | `issue list`/`search`; passing it with `--assignee` is a usage error                                                                                            |
| `--team A --team B`                  | same                | repeatable **on the three issue queries only**; elsewhere `--team` is the single default-team global                                                            |
| `--state a --state b`                | same                | repeatable; several states OR together (an issue is in one state), and each value is a state name _or_ type                                                     |
| `--created-after`, `--updated-after` | same                | `YYYY-MM-DD` or ISO 8601, inclusive; a malformed date is rejected locally instead of returning an empty list                                                    |
| `--project-label`                    | same                | matches the _project's_ label; mutually exclusive with `--project`                                                                                              |
| `--milestone`                        | same                | theirs requires `--project`; here that scoping is optional — without it the milestone is matched by name across projects                                        |
| `--search-comments`                  | `--search-comments` | `issue search` only — the plain list query has nowhere to put it                                                                                                |
| `issue update --team`                | same                | a real team move: the issue is renumbered, and Linear remaps its state while dropping the cycle, team-scoped labels and any project the new team is not part of |

Four differences we deliberately did **not** adopt: their
`issue list` is an alias of `mine` (a `list` that silently filters to you and hides started work is
the worst transition hazard, so we added `issue mine` instead of changing `list`); their JSON shape
wraps results in connection envelopes and `mine` has no `--json` at all (our uniform bare
array/object is the point); their short flags are reassigned per command (`-t` is both `--title`
and `--team` in their own tree, so there is no coherent target to match); and their per-command
option model, where we keep true globals.

## Configuration

Non-secret defaults live in `~/.config/linear/config.toml` (user-wide) or a project-local config
file. **Secrets never go in a project file** — the API key is only ever read from the flag, the
env, the user config, or the OS keyring.

Effective team precedence, highest first — `linear config` prints the tier, file, and selected
profile slug where applicable:

1. the flag (`--team`, `--workspace`, `--sort`)
2. the environment (`LINEAR_TEAM`/`LINEAR_TEAM_ID`, `LINEAR_WORKSPACE`, `LINEAR_ISSUE_SORT`)
3. the **project config**: the first file found walking up from the working directory, checking in
   each directory `linear.toml`, then `.linear.toml`, then `.config/linear.toml`; compatible
   existing project configuration is picked up as-is
4. `team` on the selected `[workspaces."<slug>"]` profile
5. the legacy top-level `team` in the **user config**, `~/.config/linear/config.toml`
   (`$XDG_CONFIG_HOME` honored)
6. the legacy **global config**, `~/.config/linear/linear.toml` — read for non-secret settings
   only, so a migrating user's defaults carry over
7. no default team

`workspace` and `sort` keep their existing flag → environment → project → user → legacy-global
order. Workspace credential selection is independent and follows the order described above.

Keys: `team` (or `team_id`), `workspace`, and `sort` (or `issue_sort`). You can write these from
the CLI. Project and top-level setting edits preserve comments and layout. Profile updates preserve
all TOML data and use the same locked, atomic rewrite as credential updates:

```sh
linear config init                    # pick a team from a list → <git root>/.linear.toml
linear config init --team TES         # …or say which (scripts); --sort, --path, --force
linear config set sort updated        # edit one key in the project config in effect
linear config set team ENG --user     # legacy top-level user fallback (backward compatible)
linear config set team ENG --user --workspace acme # validated default for the acme profile
linear config                         # show the result, with each value's source
```

`config set` will not write `api_key` or anything else that belongs to the credential store — that
is what `auth login` is for. A profile team is validated against the selected workspace whenever a
credential is available. Login, adopt, OAuth refresh/fallback, and credential migration preserve
profile metadata. Logout reports whether removing a whole profile also removed its team metadata.

```toml
# ~/.config/linear/config.toml
default_workspace = "acme"     # which stored credential is active
team = "TES"                   # optional legacy/global fallback team
sort = "priority"              # default issue-list sort: priority | updated | created

[workspaces."acme"]            # per-workspace credentials (hyphenated slugs are quoted)
keyring = true                 # secret lives in the OS keyring (service linear-cli, account acme)
team = "ENG"                   # non-secret default team for this workspace
[workspaces."other-org"]
api_key = "lin_api_yyyyyyyy"   # …or, with `auth login --plaintext`, in this 0600 file
team = "OPS"
```

Relevant environment variables: **`LINEAR_API_KEY`** or **`LINEAR_ACCESS_TOKEN`** (absolute —
bypasses workspace selection) and **`LINEAR_WORKSPACE`** (selects a stored API-key credential when
no invocation-scoped credential is given).

### Shell completion

```sh
source <(linear completion bash)                         # bash — add to ~/.bashrc
source <(linear completion zsh)                          # zsh  — add to ~/.zshrc
linear completion fish > ~/.config/fish/completions/linear.fish
```

## Raw API escape hatch

Anything without a tailored command is reachable through raw GraphQL — queries or mutations, from
an argument, a file, or stdin, with variables and optional auto-pagination:

```sh
linear api '{ viewer { id name } }'
linear api 'query($id:String!){ issue(id:$id){ title } }' --var id=TES-1
echo '{ teams { nodes { key name } } }' | linear api --query-file -
linear api --query-file q.graphql --vars-file vars.json --paginate
```

Use `linear schema` to discover types and fields first, then reach for `linear api`.

### Coverage

Coverage of the SDK is **measured, not asserted.** `linear api` reaches the full GraphQL API, and
a generated audit ([COVERAGE.md](./COVERAGE.md)) classifies every current `LinearClient` member as
`curated` (a first-class command), `raw-only` (reachable via `linear api`), or
`excluded` (admin/integration/SDK plumbing). CI fails on any drift from the committed snapshot, so
the claim stays honest as the SDK evolves.

## Programmatic use

The CLI can also be embedded:

```ts
import { createProgram } from "linear-sdk-cli";

await createProgram().parseAsync(["node", "linear", "issue", "list", "--json"]);
```

## Development

```sh
bun run verify           # typecheck + lint + unit/contract tests
bun run test:live        # live integration tests (needs LINEAR_API_KEY + LINEAR_CLI_LIVE=1)
bun run test:live:admin  # also runs admin-tier suites (e.g. team create/update)
bun run audit:changelog  # verify package, tag, and generated release-note history
bun run audit:coverage   # regenerate COVERAGE.md (add --update to re-baseline the snapshot)
bun run janitor          # sweep leaked `clitest-` fixtures from the test workspace
```

The live delegation suite is additionally gated by `LINEAR_CLI_LIVE_AGENT_ID`, the UUID of an
explicit disposable-test agent. It can trigger that integration's Agent Session/webhook and is
never enabled by the general live-test flag alone.

The live label-group suite is additionally gated by `LINEAR_CLI_TEST_LABEL_GROUP` and
`LINEAR_CLI_TEST_LABEL_GROUP_MEMBER`, naming (or identifying by UUID) a pre-existing group and one
direct member usable by `LINEAR_CLI_TEST_TEAM`. It creates only a disposable issue; it does not
create, rename, move, or delete the shared label-group fixture.

Architecture is three layers — **commands** (commander wiring) → **services** (one module per
resource, the only place that touches the SDK) → **`@linear/sdk`**. The machine JSON envelope is
locked and contract-tested so output never silently drifts.

Release Please owns `CHANGELOG.md`. Pull requests use Conventional Commit titles and are squash
merged, giving each change one release-note entry. Do not edit the changelog in a feature or fix
pull request; use a `BEGIN_COMMIT_OVERRIDE` block in the pull request body when a change needs
several or specially worded release notes.

> Live integration tests run against a real workspace and share one API key; running the entire
> suite repeatedly can hit Linear's rate limit. Run a subset (a few files at a time) or re-run
> after a short pause if you see transient rate-limit failures.

## License

[MIT](./LICENSE) © Eugene Beloded
