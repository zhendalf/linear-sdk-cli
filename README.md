# linear-sdk-cli

An ergonomic command-line interface for [Linear](https://linear.app), built on the official
[`@linear/sdk`](https://www.npmjs.com/package/@linear/sdk).

- **Human-first by default** — clean, aligned tables and detail views in your terminal.
- **Agent- and script-friendly** — `--json` everywhere emits a stable, machine-readable shape.
- **Git-aware** — the "current issue" is inferred from your branch name (`tes-123-fix` → `TES-123`).
- **Forgiving inputs** — refer to things the way you think about them: `TES-123`, team key `TES`,
  `--assignee me`, state and label by name.
- **Complete** — first-class commands for the core resource graph, plus a raw GraphQL escape
  hatch (`linear api`) so nothing in the API is out of reach.

Design influenced by [`schpet/linear-cli`](https://github.com/schpet/linear-cli) (human-first,
git-aware) and [`linearis`](https://github.com/linearis-oss/linearis) (JSON-first for agents).

## Requirements

- [Bun](https://bun.sh) **1.1 or newer** — the CLI ships as TypeScript and runs directly on Bun (no build step, no Node)
- A Linear API key (Settings → Security & access → **Personal API keys**)

## Install

```sh
bun add -g linear-sdk-cli      # or, for a one-off: bunx linear-sdk-cli --help
linear --help
```

This installs two equivalent binaries: **`linear`** and the shorter **`lin`**. If you already
have a different tool named `linear` on your `PATH`, use `lin` (or rename on install).

<details>
<summary>Run from source instead</summary>

```sh
git clone <this-repo> && cd linear-sdk-cli
bun install
bun run src/bin/linear.ts --help     # or: bun run dev -- --help
```
</details>

## Authenticate

The CLI resolves your API key from, in order: the `--api-key` flag → the `LINEAR_API_KEY`
environment variable → a stored credential in the user config file
(`~/.config/linear/config.toml`, written `0600`). For safety it is **never** read from a
project-local `.linear.toml`, so it can't be committed by accident.

```sh
export LINEAR_API_KEY=lin_api_xxxxxxxx     # quickest
linear auth login                          # or store it (prompts, then validates)
linear auth status                         # shows where the key came from (value redacted)
linear whoami                              # confirm you're connected
```

### Multiple workspaces

Credentials are stored per **workspace slug**. `auth login` validates the key and derives the
slug from the key's organization (`viewer.organization.urlKey`) unless you pass `--workspace`:

```sh
linear auth login --workspace acme         # store a key for the "acme" workspace
linear auth login --workspace other-org    # …and another
linear auth list                           # show configured workspaces + which is default
linear auth default acme                   # choose the default workspace
linear --workspace other-org issue list    # use a specific workspace for one command
linear auth token --workspace acme         # print the resolved key (for scripting)
linear auth logout --workspace acme        # remove one credential
```

**Credential selection precedence** (strict — a project file can never steer it): the
`--api-key` flag and `LINEAR_API_KEY` env are absolute and bypass selection entirely; otherwise
the workspace is chosen by `--workspace` → `LINEAR_WORKSPACE` env → `default_workspace` in the
user config. With no selection, the sole configured workspace is used; if several are configured
with no default, the CLI asks you to pick one (via `--workspace` or `auth default`).

The user config file looks like:

```toml
default_workspace = "acme"     # which credential is active
team = "TES"                    # non-secret settings stay top-level

[workspaces."acme"]
api_key = "lin_api_xxxxxxxx"
[workspaces."other-org"]        # hyphenated slugs are quoted automatically
api_key = "lin_api_yyyyyyyy"
```

## Quick start

```sh
linear issue list --assignee me --state started        # my in-progress work
linear issue view TES-42                                # full detail (or just `linear` on its branch)
linear issue create --title "Fix login" --team TES -P 2 # new High-priority issue
linear issue start TES-42 --move                        # check out its git branch + mark started
linear issue comment TES-42 "shipped — please review"
linear issue list --json | jq -r '.[].identifier'      # scripting
```

In a git repository, bare `linear` (and `linear issue`) shows the issue inferred from the
current branch, so most issue commands let you omit the id entirely.

## Git workflow

These commands turn a Linear issue into commits and a GitHub pull request. The issue id is
optional everywhere — it's inferred from the current branch (`tes-123-foo` → `TES-123`).

**`issue describe [id]`** prints the issue title and a commit-message trailer using Linear's
[git magic words](https://linear.app/docs/github#link-prs-and-commits), so the issue is linked
(and closed on merge) when the commit lands:

```sh
linear issue describe                 # on a tes-123-* branch
# Fix the login redirect loop
#
# Fixes TES-123

linear issue describe -r              # link without closing
# Fix the login redirect loop
#
# References TES-123

# drop it straight into a commit
git commit -m "$(linear issue describe)"
```

**`issue pull-request [id]`** (alias **`pr`**) opens a GitHub PR for the issue via the
[`gh`](https://cli.github.com) CLI. The PR title defaults to the issue title and the body is the
issue description followed by a `Fixes <ID>` trailer plus the Linear URL, so the PR and the issue
reference each other. The created PR URL is printed to stdout (and is the only thing on stdout in
`--json` mode):

```sh
linear issue pr                       # title/body from the inferred issue
linear issue pr TES-123 --draft       # open as a draft
linear issue pr --base main --title "Custom title"
linear issue pr --web                 # open the PR creation page in the browser
linear issue pr --json | jq -r .url   # scripting
```

`gh` must be installed and authenticated, the branch must be pushed, and the remote must be a
GitHub repo — the command does **not** push or create branches for you. If `gh` is missing or
fails (e.g. branch not pushed, not authenticated), you get a clear error, not a stack trace.

## Commands

Every group has `--help` with full options. Aliases are shown in parentheses.

| Group | What you can do |
| --- | --- |
| **`issue`** (`i`) | `view` · `list` · `search` · `create` · `update` · `delete` · `archive`/`unarchive` · `start` (git branch) · `describe` · `pull-request`/`pr` · `assign` · `state` · `label` · `comment`/`comments` · `relation` · `subscribe`/`unsubscribe` · `id`/`title`/`url`/`branch` |
| **`team`** (`t`) | `list` · `view` · `members` · `states` · `labels` · `cycles` · `create` · `update` |
| **`project`** (`p`) | `list` · `view` · `create` · `update` · `archive` · `milestones` |
| **`project-update`** (`pu`) | `create` · `list` (project status updates, with `--health`) |
| **`milestone`** (`m`) | `list` · `view` · `create` · `update` · `delete` |
| **`cycle`** (`c`) | `list` · `view` · `current` · `create` · `update` |
| **`user`** (`u`) | `list` · `view` · `me` |
| **`label`** (`lb`) | `list` · `create` · `update` · `delete` |
| **`state`** (`st`) | `list` · `view` (workflow states) |
| **`comment`** (`cm`) | `list` · `add` · `reply` · `update` · `delete` · `resolve`/`unresolve` |
| **`document`** (`doc`) | `list` · `view` · `create` · `update` · `delete` |
| **`attachment`** (`at`) | `list` · `create` · `delete` |
| **`favorite`** (`fav`) | `list` · `add` · `remove` |
| **`initiative`** (`init`) | `list` · `view` · `create` · `update` · `archive` · `delete` |
| **`initiative-update`** (`iu`) | `create` · `list` (initiative status updates, with `--health`) |
| **`roadmap`** (`rm`) | `list` · `view` · `create` · `update` · `delete` &nbsp;<sup>†</sup> |
| **`notification`** (`notif`) | `list` · `read`/`unread` · `read-all` · `archive` · `snooze` |
| **`organization`** (`org`) | `view` · `members` · `invites` |
| **`webhook`** (`wh`) | `list` · `view` · `create` · `update` · `delete` |
| **top-level** | `whoami` · `auth` (`login` · `list` · `default` · `token` · `status` · `logout`) · `config` · `api` · `commands` · `schema` · `completion` |

<sup>†</sup> Linear has **deprecated roadmaps** in favor of initiatives — reads still work, but the
API rejects roadmap mutations with a deprecation notice. Use `initiative` for new work.

## Output & global flags

| Flag | Effect |
| --- | --- |
| `--json` | Emit machine JSON only on stdout (see the contract below). |
| `--fields a,b,c` | Choose which columns/fields to show. |
| `-n, --limit <n>` / `--all` | Cap results, or fetch every page. |
| `-t, --team <key>` | Set the default team for the command. |
| `--workspace <slug>` | Select which stored workspace credential to use. |
| `-y, --yes` | Skip confirmation prompts (required for destructive actions when not a TTY). |
| `--no-input` | Never prompt; fail with a usage error instead of hanging. |
| `--no-color` · `-q, --quiet` · `--debug` | Disable color · silence status output · verbose errors. |

**JSON contract** (stable — scripts can rely on it): a list is a **bare array**, a single
resource is a **bare object**, and an error is `{"error":{"message","code"}}` on **stderr**.
Status/progress text always goes to stderr, never stdout.

**Exit codes:** `0` ok · `1` runtime/API · `2` usage · `3` not-found/ambiguous · `4` auth ·
`5` rate-limited.

## Scripting & agents

The CLI is designed to be driven by scripts and agents. Everything below is a stable contract.

**The `--json` envelope.** With `--json`, stdout carries *only* machine JSON, pretty-printed,
one value per command:

- **list** commands emit a **bare array** (`[...]`) — even when empty (`[]`) and even for a
  single result.
- **single-resource** commands (`view`, `whoami`, …) emit a **bare object** (`{...}`).
- **mutations** (`create`/`update`/`delete`/`archive`/…) emit the affected object — typically a
  small shape like `{ "id": "...", "name": "...", "url": "..." }`, or `{ "id": "...",
  "success": true }` when the API returns no body. Destructive commands add a flag such as
  `{ "deleted": true }` / `{ "archived": true }`.
- **errors** go to **stderr** as `{"error":{"message":"…","code":"…"}}` and never to stdout.

Status, progress, and pagination notes always go to **stderr**, so `cmd --json` on stdout is
safe to pipe into `jq` unconditionally:

```sh
linear issue list --json | jq -r '.[].identifier'
linear issue view TES-42 --json | jq -r '.url'
ID=$(linear issue create --title "Fix" --team TES --json | jq -r '.id')
```

**Exit codes** are stable and distinct, so a script can branch on failure class:

| Code | Name | When |
| ---: | --- | --- |
| `0` | ok | success |
| `1` | runtime/API | network/GraphQL/other runtime failure (also feature-not-accessible) |
| `2` | usage | bad flags/arguments, missing required input, validation |
| `3` | not-found/ambiguous | the referenced resource doesn't exist or a name matched many |
| `4` | auth | missing/invalid API key or forbidden |
| `5` | rate-limited | Linear rate limit hit |

The error `code` field in the JSON envelope is one of: `usage`, `auth`, `not_found`,
`ambiguous`, `forbidden`, `validation`, `rate_limited`, `network`, `feature_not_accessible`,
`api`, `runtime`. (Several map to the same exit code — e.g. `ambiguous` → `3`, `validation` →
`2`, `forbidden` → `4` — so prefer the `code` field for fine-grained handling and the exit code
for coarse branching.)

**Non-interactive flags** make runs deterministic in CI and agent loops:

- **`--no-input`** — never prompt. Any input that would otherwise be prompted for becomes a
  usage error (exit `2`) instead of hanging. Use this whenever there is no human at the keyboard.
- **`-y, --yes`** — pre-confirm destructive actions (`delete`/`archive`). Without a TTY,
  destructive commands *require* `--yes` (or they refuse rather than block).
- **`-q, --quiet`** — suppress the success/status lines on stderr (errors still print).
- **`--limit <n>` / `--all`** — `--limit` (alias `-n`) caps results; `--all` exhausts pagination
  (fetches every page). With neither, the default cap is **50**. `--all` and a large `--limit`
  can be slow and rate-limit-prone on big workspaces.

```sh
# agent-safe: no prompts, no chatter, fail fast with a parseable error
linear issue delete TES-42 --yes --no-input --quiet --json
```

**Discovery.** Two commands let an agent learn the surface area without scraping `--help`:

- **`linear commands`** — a machine-readable tree of every (sub)command. With `--json` it emits
  a bare array of `{ path, description, aliases, arguments, options }`, so an agent can enumerate
  what's available and how to call it.
- **`linear schema`** — the Linear GraphQL schema. By default it prints SDL; `-o, --output <file>`
  writes it to a file; `--json` prints the raw introspection result. Pair it with `linear api`
  to reach anything the curated commands don't wrap.

```sh
linear commands --json | jq -r '.[].path'           # every command path
linear schema -o /tmp/linear.graphql                 # dump SDL to a file
grep 'type Issue ' /tmp/linear.graphql               # then explore it
```

## Configuration file

Non-secret defaults can live in `~/.config/linear/config.toml` (user-wide) or a project-local
`.linear.toml` (walked up from the working directory):

```toml
team = "TES"          # default team key
workspace = "acme"    # workspace url slug (display only)
sort = "priority"     # default issue-list sort: priority | updated | created
vcs = "git"
```

## Shell completion

```sh
# bash — add to ~/.bashrc
source <(linear completion bash)

# zsh — add to ~/.zshrc (or drop into a directory on your fpath)
source <(linear completion zsh)

# fish
linear completion fish > ~/.config/fish/completions/linear.fish
```

## Raw API escape hatch

Anything without a tailored command is reachable through raw GraphQL — queries or mutations,
from an argument, a file, or stdin, with variables and optional auto-pagination:

```sh
linear api '{ viewer { id name } }'
linear api 'query($id:String!){ issue(id:$id){ title } }' --var id=TES-1
echo '{ teams { nodes { key name } } }' | linear api --query-file -
linear api --query-file q.graphql --vars-file vars.json --paginate
```

## Coverage

Coverage of the SDK is **measured, not asserted.** `linear api` reaches the full GraphQL API,
and a generated audit ([COVERAGE.md](./COVERAGE.md)) classifies every one of the ~460
`LinearClient` members as `curated` (a first-class command), `raw-only` (reachable via
`linear api`), or `excluded` (admin/integration/SDK plumbing). CI fails on any drift from the
committed snapshot, so the claim stays honest as the SDK evolves.

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
bun run audit:coverage   # regenerate COVERAGE.md (add --update to re-baseline the snapshot)
bun run janitor          # sweep leaked `clitest-` fixtures from the test workspace
```

Architecture is three layers — **commands** (commander wiring) → **services** (one module per
resource, the only place that touches the SDK) → **`@linear/sdk`**. The machine JSON envelope is
locked and contract-tested so output never silently drifts.

> Live integration tests run against a real workspace and share one API key; running the entire
> suite repeatedly can hit Linear's rate limit. Run a subset (a few files at a time) or re-run
> after a short pause if you see transient rate-limit failures.

## License

[MIT](./LICENSE) © Eugene Beloded
