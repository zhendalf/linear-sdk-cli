# linear-sdk-cli

**An ergonomic command-line interface for [Linear](https://linear.app), built on the official
[`@linear/sdk`](https://www.npmjs.com/package/@linear/sdk).**

It's designed to be pleasant for humans *and* dependable for scripts and agents. By default you
get clean, aligned tables and detail views; add `--json` to any command for a stable,
machine-readable shape. It's git-aware (the "current issue" comes from your branch name) and
forgiving about input (`--assignee me`, team key `TES`, state and label by name). Anything the
curated commands don't wrap is still reachable through a raw GraphQL escape hatch (`linear api`),
so nothing in the Linear API is out of bounds.

```sh
linear issue list --assignee me --state started   # what's on my plate
linear                                              # the issue for the branch you're on
linear issue list --json | jq -r '.[].identifier'  # ready for scripts
```

> Design influenced by [`schpet/linear-cli`](https://github.com/schpet/linear-cli) (human-first,
> git-aware) and [`linearis`](https://github.com/linearis-oss/linearis) (JSON-first for agents).

## Highlights

- **Human-first by default** — aligned tables and readable detail views, color-aware, paged sanely.
- **Agent- and script-friendly** — every data command takes `--json` and emits a stable, documented envelope on stdout; status text stays on stderr.
- **Git-aware** — the current issue is inferred from your branch (`tes-123-fix` → `TES-123`), so most issue commands let you drop the id.
- **Git + GitHub workflow** — `issue start` checks out the branch, `issue describe` prints a commit trailer, `issue pr` opens a GitHub PR — all linked back to the issue.
- **Forgiving inputs** — refer to things the way you think of them: `TES-123`, team `TES`, `--assignee me`, `--cycle current`, state and label by name.
- **Multi-workspace** — store credentials for several workspaces and switch with a global `--workspace`.
- **Complete & honest** — first-class commands for the core resource graph, a raw `linear api` for everything else, and a [measured coverage audit](#coverage) that CI keeps honest.

## Install

Requires [Bun](https://bun.sh) **1.1 or newer** and a Linear API key
(Settings → Security & access → **Personal API keys**). The CLI ships as TypeScript and runs
directly on Bun — no build step, no bundle, no Node.

```sh
bun add -g linear-sdk-cli      # or, for a one-off: bunx linear-sdk-cli --help
linear --help
```

This installs two equivalent binaries: **`linear`** and the shorter **`lin`**. If you already
have a different tool named `linear` on your `PATH`, just use `lin`.

<details>
<summary>Run from source instead</summary>

```sh
git clone <this-repo> && cd linear-sdk-cli
bun install
bun run src/bin/linear.ts --help     # or: bun run dev -- --help
```
</details>

## Quickstart

```sh
export LINEAR_API_KEY=lin_api_xxxxxxxx     # quickest way to get going
linear whoami                              # confirm you're connected

linear issue list --assignee me --state started        # my in-progress work
linear issue view TES-42                                # full detail
linear issue create --title "Fix login" --team TES -P 2 # new High-priority issue
linear issue start TES-42 --move                        # check out its branch + mark started
linear issue comment TES-42 "shipped — please review"
```

In a git repository, bare `linear` (and `linear issue`) shows the issue inferred from the current
branch, so most issue commands let you omit the id entirely.

## Authentication

The CLI resolves your API key in this order: the `--api-key` flag → the `LINEAR_API_KEY`
environment variable → a plaintext key in the user config file (`~/.config/linear/config.toml`,
written `0600`) → the **OS keyring** (macOS Keychain, or `secret-tool` on Linux).

> **Credential trust boundary.** The API key is **never** read from a project-local
> `.linear.toml` — only non-secret settings live there — so a key can't be committed by accident,
> and a checked-out project can never steer which credential you use.

```sh
linear auth login                          # store a key (prompts, validates, saves to the keyring)
linear auth login --plaintext              # …or keep it in the 0600 config file instead
linear auth status                         # where the key came from (value redacted)
linear auth migrate                        # move plaintext keys from the file into the keyring
linear auth token                          # print the resolved key (for scripting)
```

`auth login` stores the secret in the system keyring by default and writes only a
`keyring = true` marker to the config file; where there is no keyring (other platforms, or a Linux
box without `libsecret`) it falls back to the file, and says so. The keyring entry is
`service = linear-cli`, `account = <workspace slug>` — the same convention as
[schpet/linear-cli](https://github.com/schpet/linear-cli), so if you are coming from it your key is
found without a re-login (`auth status` reports `Source: keychain`). Note the entry is shared:
`auth logout` here removes it for both tools. `--key -` reads the key from stdin for scripts;
passing it as `--key <value>` works but earns a warning, since argv is visible to other processes.

### Multiple workspaces

Credentials are stored per **workspace slug**. `auth login` validates the key and derives the slug
from the key's organization unless you pass `--workspace`:

```sh
linear auth login --workspace acme         # store a key for the "acme" workspace
linear auth login --workspace other-org    # …and another
linear auth list                           # show configured workspaces + which is default
linear auth default acme                   # choose the default workspace
linear --workspace other-org issue list    # use a specific workspace for one command
linear auth logout --workspace acme        # remove one credential
```

**Selection precedence** (strict): the `--api-key` flag and `LINEAR_API_KEY` env are absolute and
bypass selection entirely; otherwise the workspace is chosen by `--workspace` → `LINEAR_WORKSPACE`
env → `default_workspace` in the user config. With one configured workspace it's used
automatically; with several and no default, the CLI asks you to pick (via `--workspace` or
`auth default`).

## Core concepts

A few ideas run through every command:

- **Git-branch awareness.** On a `tes-123-*` branch, bare `linear` shows `TES-123` (identical to
  `issue view TES-123`), and nearly every issue subcommand infers the id from the branch — so
  `linear issue comment "…"`, `linear issue start`, `linear issue pr` all "just work" in context.
- **Human by default, `--json` for machines.** Without `--json` you get tables and detail views
  meant to be read. With `--json`, stdout carries *only* machine JSON (a [stable
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
linear issue comment TES-42 "ready for another look"
linear issue archive TES-42 --yes
```

**Git + GitHub PR** — turn an issue into commits and a pull request. The id is inferred from the
branch everywhere below.

```sh
linear issue start TES-123 --move          # checkout tes-123-* branch and mark it started
git commit -m "$(linear issue describe)"   # commit with a "Fixes TES-123" trailer
linear issue pr                             # open a GitHub PR (title/body from the issue)
linear issue pr --draft --base main        # …as a draft against a specific base
linear issue pr --json | jq -r .url        # the created PR URL is the only thing on stdout
```

`issue describe` prints the issue title plus a commit trailer using Linear's
[git magic words](https://linear.app/docs/github#link-prs-and-commits) (`Fixes TES-123`, or
`References TES-123` with `-r`), so the issue is linked — and closed on merge — when the commit
lands. `issue pull-request` (alias `pr`) opens the PR via the [`gh`](https://cli.github.com) CLI:
the body is the issue description followed by a `Fixes <ID>` trailer and the Linear URL, so the PR
and issue reference each other. It never pushes or creates branches for you, and fails with a
clear error (not a stack trace) when `gh` is missing, unauthenticated, or the branch isn't pushed.

**Projects & status updates**

```sh
linear project list --team TES
linear project view "Q3 Launch"
linear project-update create "Q3 Launch" --health onTrack --body "Beta is out to 10% of users."
linear initiative-update create "Platform" --health atRisk --body-file update.md
```

Status updates (`project-update`/`pu`, `initiative-update`/`iu`) take the body from `--body`,
`--body-file <path>` (`-` for stdin), or `--editor` (`$EDITOR`), plus an optional
`--health <onTrack|atRisk|offTrack>`.

## Command overview

Every group has `--help` with full options and (for the busy ones) an Examples section. Aliases
are shown in parentheses. For a machine-readable tree of *every* command, run
`linear commands --json`.

| Group | What you can do |
| --- | --- |
| **`issue`** (`i`) | `view` · `list` · `mine` · `search` · `create` · `update` · `delete` · `archive`/`unarchive` · `start` (git branch) · `describe` · `pull-request`/`pr` · `assign` · `state` · `label` · `comment`/`comments` · `relation` · `subscribe`/`unsubscribe` · `id`/`title`/`url`/`branch` |
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

### Global flags

| Flag | Effect |
| --- | --- |
| `--json` | Emit machine JSON only on stdout (see [the contract](#scripting--agents)). |
| `-f, --fields a,b,c` | Choose which columns to show (table output). |
| `-n, --limit <n>` / `--all` | Cap results, or fetch every page. |
| `-t, --team <key>` | Set the default team for the command. |
| `--workspace <slug>` | Select which stored workspace credential to use. |
| `-y, --yes` | Skip confirmation prompts (required for destructive actions when not a TTY). |
| `--no-input` | Never prompt; fail with a usage error instead of hanging. |
| `--no-ansi` | Disable colored output (`--no-color` is accepted as an alias). |
| `-q, --quiet` · `--debug` | Silence status output · verbose errors. |

## Scripting & agents

The CLI is built to be driven by scripts and agents. Everything in this section is a stable
contract.

**The `--json` envelope.** With `--json`, stdout carries *only* machine JSON, pretty-printed, one
value per command:

- **list** commands emit a **bare array** (`[...]`) — even when empty (`[]`) and even for a single result.
- **single-resource** commands (`view`, `whoami`, …) emit a **bare object** (`{...}`).
- **mutations** (`create`/`update`/`delete`/`archive`/…) emit the affected object — typically a
  small shape like `{ "id", "identifier", "url" }`, or `{ "id", "success": true }` when the API
  returns no body. Destructive commands add a flag such as `{ "deleted": true }` / `{ "archived": true }`.
- **errors** go to **stderr** as `{"error":{"message":"…","code":"…"}}` and never to stdout. With
  `--debug`, the extra detail is carried *inside* that object as `error.detail` rather than appended
  after it, so `--json --debug` output stays parseable.

Status, progress, and pagination notes always go to **stderr**, so `cmd --json` is safe to pipe
into `jq` unconditionally:

```sh
linear issue list --json | jq -r '.[].identifier'
linear issue view TES-42 --json | jq -r '.url'
ID=$(linear issue create --title "Fix" --team TES --json | jq -r '.id')
```

**Exit codes** are stable and distinct, so a script can branch on the failure class:

| Code | Name | When |
| ---: | --- | --- |
| `0` | ok | success |
| `1` | runtime/API | network/GraphQL/other runtime failure (also feature-not-accessible) |
| `2` | usage | bad flags/arguments, missing required input, validation |
| `3` | not-found/ambiguous | the referenced resource doesn't exist, or a name matched many |
| `4` | auth | missing/invalid API key, or forbidden |
| `5` | rate-limited | Linear rate limit hit |
| `6` | cancelled | a confirmation prompt was declined — nothing was changed |

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
  destructive commands *require* `--yes` (they refuse rather than block). If a human declines the
  prompt, the command exits **`6`** and reports `{"cancelled": true, "action": "…"}` under `--json`
  — never `0`, so `linear issue delete X && …` cannot run the `&&` side after a "no".
- **`-q, --quiet`** — suppress success/status lines on stderr (errors still print).
- **`-n, --limit <n>` / `--all`** — `--limit` caps results; `--all` exhausts pagination. With
  neither, the default cap is **50**. `--all` (and very large `--limit`) can be slow and
  rate-limit-prone on big workspaces.

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
too, so you can pipe GraphQL straight in.

**Agent skill.** This repo ships a Claude agent skill at `skills/linear-sdk-cli/` that teaches an
agent to drive the CLI (the JSON envelope, exit codes, discovery, and forgiving inputs). Point a
compatible agent at it to get reliable Linear automation out of the box.

## Coming from linear-cli

If your fingers or your scripts learned the other `linear-cli`, most of its spellings work here
unchanged. The left column is theirs, the right is the canonical one this CLI documents and prints
in `--help`; both are accepted, and passing both at once is a usage error rather than a silent pick.

| linear-cli | here | where |
| --- | --- | --- |
| `-j, --json` | same | every command (global) |
| `-w, --web` | same | `issue view`, `issue pull-request` |
| `--due-date` | `--due` | `issue create`, `issue update` |
| `--target-date` | `--target` | `project`/`milestone`/`initiative` create & update |
| `--start-date` | `--start` | `project create`, `project update` |
| `--search` | `--query` | `issue list`, `issue mine` |
| `--status` | `--state` | `project list` |
| `--all-states` | (no-op) | `issue list` — it already spans every state |
| `--limit 0` | `--all` | every list; `--all` is the spelling we teach |
| `--assignee self` | `me` / `@me` | anywhere a user is named |
| `--cycle active` | `current` | anywhere a cycle is named |
| `--cycle "<name>"` | number, name, or id | all three resolve |
| `issue query` | `issue list` | same command |
| `auth whoami` | `whoami` | both spellings registered |
| `issue comment add\|list\|update\|delete` | `comment add\|list\|…` | both mounted on one implementation |

Their query filters all exist here too, under the same names — `issue list`, `issue mine` and
`issue search` share one filter set:

| linear-cli | here | notes |
| --- | --- | --- |
| `-U, --unassigned` | same | `issue list`/`search`; passing it with `--assignee` is a usage error |
| `--team A --team B` | same | repeatable **on the three issue queries only**; elsewhere `--team` is the single default-team global |
| `--state a --state b` | same | repeatable; several states OR together (an issue is in one state), and each value is a state name *or* type |
| `--created-after`, `--updated-after` | same | `YYYY-MM-DD` or ISO 8601, inclusive; a malformed date is rejected locally instead of returning an empty list |
| `--project-label` | same | matches the *project's* label; mutually exclusive with `--project` |
| `--milestone` | same | theirs requires `--project`; here that scoping is optional — without it the milestone is matched by name across projects |
| `--search-comments` | `--search-comments` | `issue search` only — the plain list query has nowhere to put it |
| `issue update --team` | same | a real team move: the issue is renumbered, and Linear remaps its state while dropping the cycle, team-scoped labels and any project the new team is not part of |

Four differences we deliberately did **not** adopt (see `ALIGNMENT.md` for the reasoning): their
`issue list` is an alias of `mine` (a `list` that silently filters to you and hides started work is
the worst transition hazard, so we added `issue mine` instead of changing `list`); their JSON shape
wraps results in connection envelopes and `mine` has no `--json` at all (our uniform bare
array/object is the point); their short flags are reassigned per command (`-t` is both `--title`
and `--team` in their own tree, so there is no coherent target to match); and their per-command
option model, where we keep true globals.

## Configuration

Non-secret defaults live in `~/.config/linear/config.toml` (user-wide) or a project-local
`.linear.toml` (walked up from the working directory). **Secrets never go in `.linear.toml`** — the
API key is only ever read from the user config, the env, or the flag.

```toml
# ~/.config/linear/config.toml
default_workspace = "acme"     # which stored credential is active
team = "TES"                   # default team key
sort = "priority"              # default issue-list sort: priority | updated | created
vcs = "git"

[workspaces."acme"]            # per-workspace credentials (hyphenated slugs are quoted)
keyring = true                 # secret lives in the OS keyring (service linear-cli, account acme)
[workspaces."other-org"]
api_key = "lin_api_yyyyyyyy"   # …or, with `auth login --plaintext`, in this 0600 file
```

Relevant environment variables: **`LINEAR_API_KEY`** (absolute — bypasses workspace selection) and
**`LINEAR_WORKSPACE`** (selects a stored credential when no flag is given).

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
a generated audit ([COVERAGE.md](./COVERAGE.md)) classifies every one of the ~460 `LinearClient`
members as `curated` (a first-class command), `raw-only` (reachable via `linear api`), or
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
