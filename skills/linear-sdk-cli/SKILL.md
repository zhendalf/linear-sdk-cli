---
name: linear-sdk-cli
description: Manage Linear from the command line and automate Linear workflows with the `linear` (alias `lin`) CLI. Use this whenever an agent needs to read or modify Linear issues, projects, cycles, initiatives, comments, labels, documents, or any other Linear resource — listing, viewing, creating, updating, deleting, or reaching the raw GraphQL API.
allowed-tools: Bash(linear:*), Bash(lin:*), Bash(curl:*)
---

# Linear SDK CLI

`linear` (alias `lin`) is an ergonomic, agent-friendly command-line interface for
Linear, built on `@linear/sdk`. It is designed to be driven by scripts and agents:
every data command has a stable `--json` envelope, stable exit codes, file-based
body inputs, and machine-readable discovery commands. (`completion` is the one
exception — it always prints a shell script.)

## Prerequisites

Check the CLI is installed:

```bash
linear --version   # or: lin --version
```

### Authentication

The CLI needs a Linear API key. Three ways to provide one, in order of precedence:

1. **`--api-key <key>`** flag (per invocation) or **`LINEAR_API_KEY`** env var — best
   for CI and ephemeral agent runs:

   ```bash
   LINEAR_API_KEY=lin_api_... linear whoami --json
   ```

2. **Stored credentials** via `linear auth login` (validates the key and saves it):

   ```bash
   linear auth login --key lin_api_...        # non-interactive
   linear auth login                          # prompts for the key (interactive only)
   ```

3. **Multiple workspaces** — store several credentials and select one per call with
   `--workspace <slug>`; set a default with `linear auth default <slug>`:

   ```bash
   linear auth list                  # show configured workspace credentials
   linear auth default acme          # make 'acme' the default
   linear issue list --workspace acme --json
   ```

Inspect resolution with `linear auth status`. Get the resolved key for scripting
(e.g. raw `curl`) with `linear auth token`.

## Agent best practices

This CLI is built for non-interactive use. Follow these and it will never hang and
always emit parseable output.

### Always pass `--json`

On every data command, **stdout carries only machine JSON** (status/progress notes go to
stderr), so it is always safe to pipe into `jq`. The envelope is a stable contract:

- **list** commands → a **bare array** `[...]` (even when empty `[]`, even for one result).
- **single-resource** commands (`view`, `whoami`, …) → a **bare object** `{...}`.
- **mutations** (`create`/`update`/`delete`/`archive`/…) → the affected object, e.g.
  `{ "id": "...", "url": "..." }`, or `{ "id": "...", "success": true }` when the API
  returns no body; destructive commands add a flag like `{ "deleted": true }` /
  `{ "archived": true }`.
- **errors** → **stderr** as `{"error":{"message":"…","code":"…"}}`, never on stdout.

```bash
linear issue list --json | jq -r '.[].identifier'
linear issue view TES-42 --json | jq -r '.url'
ID=$(linear issue create --title "Fix" --team TES --json | jq -r '.id')
```

### Fail fast, never prompt

- **`--no-input`** — never prompt. Anything that would be prompted for becomes a usage
  error (exit `2`) instead of hanging. Use this whenever no human is at the keyboard.
  (In a non-TTY the CLI already refuses to block, but `--no-input` makes it explicit.)
- **`-y, --yes`** — pre-confirm destructive actions (`delete`/`archive`). Without a TTY,
  destructive commands _require_ `--yes` or they refuse rather than block.
- **`-q, --quiet`** — suppress success/status lines on stderr (errors still print).

```bash
# agent-safe: no prompts, no chatter, parseable error on failure
linear issue delete TES-42 --yes --no-input --quiet --json
```

### Branch on exit codes and error `code`s

Exit codes are stable and distinct:

| Exit | Meaning                                                          |
| ---: | ---------------------------------------------------------------- |
|  `0` | ok                                                               |
|  `1` | runtime/API failure (network, GraphQL, feature-not-accessible)   |
|  `2` | usage — bad flags/arguments, missing required input, validation  |
|  `3` | not-found / ambiguous (resource missing, or a name matched many) |
|  `4` | auth — missing/invalid key or forbidden                          |
|  `5` | rate-limited                                                     |

The error envelope's `code` field is finer-grained — one of: `usage`, `auth`,
`not_found`, `ambiguous`, `forbidden`, `validation`, `rate_limited`, `network`,
`feature_not_accessible`, `api`, `runtime`. Several map to the same exit code (e.g.
`ambiguous` → `3`, `validation` → `2`, `forbidden` → `4`). Prefer `code` for precise
handling and the exit code for coarse branching:

```bash
if ! out=$(linear issue view BAD-1 --json 2>err.json); then
  code=$(jq -r '.error.code' err.json)   # e.g. "not_found"
  echo "failed: $code"
fi
```

### Prefer file-based body flags over inline markdown

For any markdown body — issue/initiative descriptions, comment bodies, document
content — **use the file flag, not the inline flag**. It avoids shell-escaping
headaches with newlines, quotes, and special characters, and keeps `\n` from leaking
into the rendered markdown. The file flags accept `-` to read **stdin**, which pairs
perfectly with a heredoc:

- `issue create` / `issue update` / `initiative create` / `initiative update` →
  `--description-file <path>` (and `--description-file -` for stdin)
- `comment add` / `comment update` / `comment reply` → `--body-file <path>`
- `document create` / `document update` → `--content-file <path>`

```bash
linear issue create --title "Onboarding bug" --team TES --no-input --json \
  --description-file - <<'EOF'
## Summary

The signup flow 500s when the email contains a `+`.

## Steps
1. Sign up as `a+b@example.com`
2. Observe the error
EOF
```

For short, single-line content, use inline `-d/--description` (issues/initiatives),
the positional `[body]` arg (comments: `linear comment add TES-42 "lgtm"`), or
`--body` (status updates). There is no `-b` short flag.

### Discovery — learn the surface without scraping help

Lead with these two machine-readable commands:

- **`linear commands --json`** — the full command tree as a bare array of
  `{ path, description, aliases, arguments, options }`. Enumerate everything callable:

  ```bash
  linear commands --json | jq -r '.[].path'                      # every command path
  linear commands --json | jq '.[] | select(.path=="issue create").options'
  ```

- **`linear schema -o <file>`** — dump the Linear GraphQL schema as SDL to a file, then
  grep it to find types/fields for `linear api`:

  ```bash
  linear schema -o "${TMPDIR:-/tmp}/linear.graphql"
  grep -n 'type Issue ' "${TMPDIR:-/tmp}/linear.graphql"
  ```

## Available commands

Generated from `linear commands --json` (run `bun run skill:docs` to refresh):

<!-- BEGIN GENERATED COMMANDS -->

```text
linear api

linear attachment
linear attachment create
linear attachment delete
linear attachment list

linear auth
linear auth default
linear auth list
linear auth login
linear auth logout
linear auth status
linear auth token
linear auth whoami

linear commands

linear comment
linear comment add
linear comment delete
linear comment list
linear comment reply
linear comment resolve
linear comment unresolve
linear comment update

linear completion

linear config

linear cycle
linear cycle create
linear cycle current
linear cycle list
linear cycle update
linear cycle view

linear document
linear document create
linear document delete
linear document list
linear document update
linear document view

linear favorite
linear favorite add
linear favorite list
linear favorite remove

linear initiative
linear initiative archive
linear initiative create
linear initiative delete
linear initiative list
linear initiative update
linear initiative view

linear initiative-update
linear initiative-update create
linear initiative-update list

linear issue
linear issue archive
linear issue assign
linear issue branch
linear issue comment
linear issue comment add
linear issue comment delete
linear issue comment list
linear issue comment update
linear issue comments
linear issue create
linear issue delete
linear issue describe
linear issue id
linear issue label
linear issue list
linear issue mine
linear issue pull-request
linear issue relation
linear issue search
linear issue start
linear issue state
linear issue subscribe
linear issue title
linear issue unarchive
linear issue unsubscribe
linear issue update
linear issue url
linear issue view

linear label
linear label create
linear label delete
linear label list
linear label update

linear milestone
linear milestone create
linear milestone delete
linear milestone list
linear milestone update
linear milestone view

linear notification
linear notification archive
linear notification list
linear notification read
linear notification read-all
linear notification snooze
linear notification unread

linear organization
linear organization invites
linear organization members
linear organization view

linear project
linear project archive
linear project create
linear project list
linear project milestones
linear project update
linear project view

linear project-update
linear project-update create
linear project-update list

linear roadmap
linear roadmap create
linear roadmap delete
linear roadmap list
linear roadmap update
linear roadmap view

linear schema

linear state
linear state list
linear state view

linear team
linear team create
linear team cycles
linear team labels
linear team list
linear team members
linear team states
linear team update
linear team view

linear user
linear user list
linear user me
linear user view

linear webhook
linear webhook create
linear webhook delete
linear webhook list
linear webhook update
linear webhook view

linear whoami
```

<!-- END GENERATED COMMANDS -->

## Reference documentation

One file per command group, generated from `linear commands --json`. These are
supplementary — `--help` on any command is authoritative.

- [api](references/api.md) — Run a raw GraphQL query or mutation against the Linear API
- [attachment](references/attachment.md) — Work with issue attachments
- [auth](references/auth.md) — Manage authentication
- [commands](references/commands.md) — Machine-readable command tree (for scripts/agents)
- [comment](references/comment.md) — Manage comments
- [completion](references/completion.md) — Output a shell completion script
- [config](references/config.md) — Show the resolved configuration (secrets redacted)
- [cycle](references/cycle.md) — Work with cycles
- [document](references/document.md) — Work with documents
- [favorite](references/favorite.md) — Manage your favorites
- [initiative](references/initiative.md) — Work with initiatives
- [initiative-update](references/initiative-update.md) — Post and list initiative status updates
- [issue](references/issue.md) — Work with issues
- [label](references/label.md) — Work with issue labels
- [milestone](references/milestone.md) — Work with project milestones
- [notification](references/notification.md) — Work with your notifications
- [organization](references/organization.md) — Inspect the current workspace
- [project](references/project.md) — Work with projects
- [project-update](references/project-update.md) — Post and list project status updates
- [roadmap](references/roadmap.md) — Work with roadmaps
- [schema](references/schema.md) — Print the Linear GraphQL schema as SDL
- [state](references/state.md) — Inspect workflow states
- [team](references/team.md) — Inspect and manage teams
- [user](references/user.md) — Inspect workspace users
- [webhook](references/webhook.md) — Manage workspace webhooks
- [whoami](references/whoami.md) — Show the authenticated user

## Discovering options

`--help` on any command lists its flags; `linear commands --json` gives the same as
data:

```bash
linear --help
linear issue --help
linear issue create --help
linear commands --json | jq '.[] | select(.path=="issue list")'
```

Useful surface notes (all verified against the current CLI):

- `issue describe [id]` prints the issue title plus a git-trailer line; `issue pull-request`
  (alias `pr`) creates a GitHub PR from the issue. `issue start`/`issue branch` help with
  branch workflows.
- `cycle create`/`cycle update` use `--start <date>` and `--end <date>` (ISO); `cycle current`
  resolves the active cycle. Issue commands take `--cycle <n|id|current>`.
- `initiative create`/`update` use `--target <date>` for the estimated completion date,
  plus `--owner` and `--status`.
- `label create` adds `--shared` to create a workspace-level (shared) label even when a
  default team is set, and `--parent <name>` for sub-labels.
- `project-update` (alias `pu`) and `initiative-update` (alias `iu`) post and list status
  updates.

## Raw GraphQL API

When a curated command doesn't cover what you need, drop to raw GraphQL with
`linear api`. Inspect the schema first (`linear schema -o file`) to find types/fields.

**Pass queries containing non-null type markers (a type followed by `!`) via heredoc
stdin, not inline** — this avoids shell history-expansion and quoting issues with `!`.
Simple queries without `!` are fine inline.

```bash
# Simple query — inline is fine (no `!`)
linear api '{ viewer { id name email } }'

# Query with variables — heredoc + --query-file - (reads the query from stdin)
linear api --query-file - --var id=TES-1 <<'GRAPHQL'
query($id: String!) { issue(id: $id) { identifier title state { name } } }
GRAPHQL

# Multiple string variables (repeat --var k=v)
linear api --query-file - --var term=onboarding --var n=20 <<'GRAPHQL'
query($term: String!) { searchIssues(term: $term) { nodes { identifier title } } }
GRAPHQL

# Complex / typed variables via JSON (inline or from a file with --vars-file)
linear api --query-file - --vars '{"filter":{"state":{"name":{"eq":"In Progress"}}}}' <<'GRAPHQL'
query($filter: IssueFilter!) { issues(filter: $filter) { nodes { identifier title } } }
GRAPHQL

# Auto-follow pagination on the first connection
linear api --query-file q.graphql --vars-file vars.json --paginate

# Pipe data straight to jq (status notes go to stderr)
linear api '{ issues(first: 5) { nodes { identifier title } } }' | jq '.data.issues.nodes[].title'
```

`api` flags: `--query-file <path>` (`-` = stdin), `--var <k=v>` (repeatable string
vars), `--vars <json>`, `--vars-file <path>` (`-` = stdin), `--operation <name>`,
`--paginate`, `--raw` (full response incl. extensions), `--json`.

### Raw `curl` fallback

For full HTTP control, get the resolved key with `linear auth token` (Linear expects
the raw key in the `Authorization` header — no `Bearer` prefix):

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $(linear auth token)" \
  -d '{"query": "{ viewer { id } }"}'
```
