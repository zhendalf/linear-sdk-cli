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
linear --version   # or: lin --version — prints 0.x for this CLI
```

If that fails, or prints `2.x` (that is `schpet/linear-cli`, a different tool that shares the
`linear` name), install this one — it needs Bun ≥ 1.1:

```bash
bun add --global linear-sdk-cli  # installs `linear` and collision-free `lin`
lin --version
```

`lin` is the safe spelling when both might be present. If the user is coming from
`schpet/linear-cli`, their credentials and `.linear.toml` are picked up automatically — see
`MIGRATING.md` in the package; do not ask them to re-enter an API key before running
`linear auth status`.

### Authentication

The CLI supports distinct human, hosted-app, and personal-key lifecycles:

1. **Human browser OAuth (default)** via Authorization Code + PKCE S256, `actor=user`:

   ```bash
   linear auth login                    # opens Linear; read + write scopes
   linear auth login --read-only        # read scope only
   linear auth login --no-browser       # prints URL; loopback callback still required
   ```

   The CLI validates the viewer/workspace and stores the access token, rotating refresh token,
   expiry, scopes, client identity, and workspace identity only in the OS keyring. It refreshes
   before expiry and once after an authentication failure. `--admin` is explicit; no client secret
   is embedded. `auth logout` revokes this grant before removing it (`--local-only` skips
   revocation). Remote/headless callers need the loopback host reachable; Linear has no documented
   device-code flow.

2. **Invocation OAuth access token** via `--access-token <token>` or `LINEAR_ACCESS_TOKEN` — use
   this for hosted Linear apps, agents, and service accounts. Prefer the environment variable so
   the secret does not appear in argv:

   ```bash
   LINEAR_ACCESS_TOKEN=... linear whoami --json
   ```

   The host application owns OAuth installation, token refresh/client-credentials exchange,
   client-secret storage, and webhooks. These tokens remain invocation-scoped.
   Long-lived hosts can import `ClientCredentialsTokenProvider` from `linear-sdk-cli`; it caches
   the 30-day app token in memory, renews before expiry, coalesces concurrent exchanges, and
   supports invalidation or forced renewal for one bounded retry after a `401`. Keep the client
   secret in the host's secret manager and inject only `LINEAR_ACCESS_TOKEN` into CLI children.
   Serverless hosts need a secure shared token cache or broker so cold starts do not mint a new
   token for every command.

3. **`--api-key <key>`** flag (per invocation) or **`LINEAR_API_KEY`** env var — best
   for CI and ephemeral agent runs:

   ```bash
   LINEAR_API_KEY=lin_api_... linear whoami --json
   ```

4. **Stored personal API-key credentials** via the explicit compatibility path:

   ```bash
   printf '%s\n' "$LINEAR_API_KEY" | linear auth login --key -
   ```

   Passing `--key <value>` also works but exposes it in argv and produces a warning. API keys may
   use `--plaintext`; browser OAuth is always keyring-only.

5. **Multiple workspaces** — store several OAuth or API-key credentials and select one per call with
   `--workspace <slug>`; set a default with `linear auth default <slug>`:

   ```bash
   linear auth list                  # show configured workspace credentials
   linear auth default acme          # make 'acme' the default
   linear issue list --workspace acme --json
   ```

An explicit credential flag overrides environment credentials. If both credential kinds occur at
the same precedence level, the CLI fails rather than silently choosing an actor. Inspect resolution
with `linear auth status`. `linear auth token` exports stored API keys only and never OAuth tokens.

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
- **errors** → **stderr** as `{"error":{"message":"…","code":"…"}}`, never on stdout. With
  `--debug` the extra detail rides _inside_ that object as `error.detail`, so `--json --debug`
  stays parseable.

Relations are **objects with ids**, on list rows and on `view` alike — `state: {id,name,type}`,
`team: {id,key,name}`, `assignee: {id,displayName,email}`, `project`/`milestone: {id,name}`,
`cycle: {id,number,name}`, `parent: {id,identifier}`, `labels: [{id,name}]` — so `.state.name`
reads the same everywhere and the id you need to act on is already in hand. Issues also carry
`archivedAt` and `trashed`; a deleted issue still views, and says so.

```bash
linear issue list --json | jq -r '.[].identifier'
linear issue view TES-42 --json | jq -r '.url'
linear issue view TES-42 --json | jq -r '.state.type, .team.key, .assignee.id'
ID=$(linear issue create --title "Fix" --team TES --json | jq -r '.id')
```

### Know the keys before you run anything

**Do not guess field names** (`comment list` rows carry `author`? No — `user`; `comment reply`
returns `parentId`? No — `parent`). Every command's `--json` shape is declared and testable, and
`linear commands <path>` prints it — the same text the per-command reference files carry:

```bash
linear commands issue list                          # options, then "Output (--json): array of objects:" + one `key: type` per line
linear commands comment reply --json | jq '.output' # {"kind":"receipt","fields":{"id":"string","parent":"string","issue":"string|null","url":"string"}}
linear commands --json | jq -r '.[] | select(.output.kind=="list") | .path'   # every command that prints an array
```

`output` reads as:

- `kind` — `list` (bare array of `fields`-shaped rows), `object` (a `view`, `whoami`, …), `receipt`
  (a mutation: ids plus what happened), `raw` (`api`, `schema`: keys depend on the request), `none`
  (`completion` never prints JSON). A group that only holds subcommands has no `output`.
- `fields` — key → type. Scalars are `"string"`, `"number"`, `"boolean"` (`"string|null"` when the
  value may be null); an object is nested `{…}`; an array is `[<type>]`; a relation that may be
  null is `{"nullable": {…}}`; a key spelled `"comments?"` is present only sometimes (its `note`
  or `variants` say when).
- `variants` — a different output under a flag or argument (`"--web"`, `"--start"`, `"op=list"`),
  each a whole shape of its own.

The shapes cannot lie: each is checked against the TypeScript type the service returns at
compile time, and a test runs every command and compares what it printed to what it declared.

### Fail fast, never prompt

- **`--no-input`** — never prompt. Anything that would be prompted for becomes a usage
  error (exit `2`) instead of hanging. **`--json` already implies this**, as does a stdout
  that is not a TTY, so an agent gets it for free; pass it anyway when you want the
  intent on the record.
- **`-y, --yes`** — pre-confirm destructive actions (`delete`/`archive`). Without a TTY,
  destructive commands _require_ `--yes` or they refuse rather than block. If a human
  declines the prompt, the command exits `6` and prints `{"cancelled": true, "action": "…"}`
  under `--json` — never `0`.
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
|  `6` | cancelled — a confirmation prompt was declined; nothing changed  |

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

Comments canonically use `add`, while resources such as attachments use `create`.
`create` is also accepted as a compatibility alias for comment `add`. For a file-backed
issue comment, copy this form:

```bash
linear issue comment add LUMI-9340 --body-file comment.md --json
```

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
`--body` (status updates). There is no `-b` short flag. The CLI rejects an inline
body containing literal `\n` sequences and points back to stdin; never encode a
multiline body by inserting `\n` inside an ordinary quoted argument.

### Mentions require explicit intent

Never assume that `@name` in comment text should notify somebody: the CLI keeps it as literal
Markdown. Add the repeatable `--mention <name|email|me|id>` option only when the user explicitly
asks for a real mention. It resolves each workspace user and prepends the notification-capable
mention before the supplied body:

```bash
linear comment add TES-42 "Please review." --mention ada --json
linear issue comment TES-42 --body-file - --mention me --json <<'EOF'
This deliberately mentions me; the @example in this sentence remains literal.
EOF
```

`--mention` is available on `issue comment`, `comment add`, `comment reply`, and `comment update`
(including the `issue comment add/update` mounts). It is repeatable and deduplicates users.

### Discovery — learn the surface without scraping help

Lead with these two machine-readable commands:

- **`linear commands --json`** — the full command tree as a bare array of
  `{ path, description, aliases, arguments, options, output }`; `linear commands <path> --json`
  is one command as a bare object. `output` is what that command prints under `--json` (see
  "Know the keys before you run anything" above). Enumerate everything callable:

  ```bash
  linear commands --json | jq -r '.[].path'                      # every command path
  linear commands issue create --json | jq '.options'            # one command's flags
  linear commands issue create --json | jq '.output.fields'      # …and its --json keys
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
linear auth adopt
linear auth default
linear auth list
linear auth login
linear auth logout
linear auth migrate
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
linear config init
linear config set
linear config show

linear custom-view
linear custom-view create
linear custom-view delete
linear custom-view list
linear custom-view results
linear custom-view update
linear custom-view view

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
linear initiative add-project
linear initiative archive
linear initiative create
linear initiative delete
linear initiative list
linear initiative remove-project
linear initiative unarchive
linear initiative update
linear initiative view

linear initiative-update
linear initiative-update create
linear initiative-update list

linear issue
linear issue agent-session
linear issue agent-session list
linear issue agent-session view
linear issue archive
linear issue assign
linear issue attach
linear issue branch
linear issue comment
linear issue comment add
linear issue comment delete
linear issue comment list
linear issue comment update
linear issue comments
linear issue create
linear issue delegate
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

linear open

linear organization
linear organization invites
linear organization members
linear organization view

linear project
linear project archive
linear project create
linear project delete
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
linear team delete
linear team id
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

One file per command group, generated from `linear commands --json`: every command's options
and, under **Output (`--json`)**, the exact keys and types it prints (`linear commands <path>`
prints the same). These are supplementary — `--help` on any command is authoritative.

- [api](references/api.md) — Run a raw GraphQL query or mutation against the Linear API
- [attachment](references/attachment.md) — Work with issue attachments
- [auth](references/auth.md) — Manage authentication
- [commands](references/commands.md) — Machine-readable command tree (for scripts/agents)
- [comment](references/comment.md) — Manage comments
- [completion](references/completion.md) — Output a shell completion script
- [config](references/config.md) — Show the resolved configuration (secrets redacted)
- [custom-view](references/custom-view.md) — Create and manage saved custom views
- [cycle](references/cycle.md) — Work with cycles
- [document](references/document.md) — Work with documents
- [favorite](references/favorite.md) — Manage your favorites
- [initiative](references/initiative.md) — Work with initiatives
- [initiative-update](references/initiative-update.md) — Post and list initiative status updates
- [issue](references/issue.md) — Work with issues
- [label](references/label.md) — Work with issue labels
- [milestone](references/milestone.md) — Work with project milestones
- [notification](references/notification.md) — Work with your notifications
- [open](references/open.md) — Open the workspace, an issue, team, project, or URL
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

- `issue describe [id]` prints a commit message (`ID Title`, then `Linear-issue: Fixes ID` /
  `Linear-issue-url:` trailers); `issue pull-request` (alias `pr`) creates a GitHub PR titled
  `ID Title` with those trailers as the body. `issue start` checks the branch out AND moves the
  issue to the first `started` state (`--no-move` for branch only); `issue branch` prints the name.
- `--fields`, `--limit`, `--all` are refused (usage error) on commands that print only a receipt
  — every mutation, `issue id`, `commands`, … — so `-f <file>` cannot be swallowed silently.
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
