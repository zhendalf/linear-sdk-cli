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

- Node.js **18 or newer**
- A Linear API key (Settings → Security & access → **Personal API keys**)

## Install

```sh
npm install -g linear-sdk-cli      # or: pnpm add -g linear-sdk-cli  /  bun add -g linear-sdk-cli
linear --help
```

This installs two equivalent binaries: **`linear`** and the shorter **`lin`**. If you already
have a different tool named `linear` on your `PATH`, use `lin` (or rename on install).

<details>
<summary>Run from source instead</summary>

```sh
git clone <this-repo> && cd linear-sdk-cli
pnpm install
pnpm build
node dist/bin/linear.js --help     # or, without building: pnpm dev -- --help
```
</details>

## Authenticate

The CLI resolves your API key from, in order: the `--api-key` flag → the `LINEAR_API_KEY`
environment variable → the user config file (`~/.config/linear/config.toml`, written `0600`).
For safety it is **never** read from a project-local `.linear.toml`, so it can't be committed
by accident.

```sh
export LINEAR_API_KEY=lin_api_xxxxxxxx     # quickest
linear auth login                          # or store it (prompts, then validates)
linear auth status                         # shows where the key came from (value redacted)
linear whoami                              # confirm you're connected
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

## Commands

Every group has `--help` with full options. Aliases are shown in parentheses.

| Group | What you can do |
| --- | --- |
| **`issue`** (`i`) | `view` · `list` · `search` · `create` · `update` · `delete` · `archive`/`unarchive` · `start` (git branch) · `assign` · `state` · `label` · `comment`/`comments` · `relation` · `subscribe`/`unsubscribe` · `id`/`title`/`url`/`branch` |
| **`team`** (`t`) | `list` · `view` · `members` · `states` · `labels` · `cycles` · `create` · `update` |
| **`project`** (`p`) | `list` · `view` · `create` · `update` · `archive` · `milestones` · `updates` |
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
| **`roadmap`** (`rm`) | `list` · `view` · `create` · `update` · `delete` &nbsp;<sup>†</sup> |
| **`notification`** (`notif`) | `list` · `read`/`unread` · `read-all` · `archive` · `snooze` |
| **`organization`** (`org`) | `view` · `members` · `invites` |
| **`webhook`** (`wh`) | `list` · `view` · `create` · `update` · `delete` |
| **top-level** | `whoami` · `auth` · `config` · `api` · `completion` |

<sup>†</sup> Linear has **deprecated roadmaps** in favor of initiatives — reads still work, but the
API rejects roadmap mutations with a deprecation notice. Use `initiative` for new work.

## Output & global flags

| Flag | Effect |
| --- | --- |
| `--json` | Emit machine JSON only on stdout (see the contract below). |
| `--fields a,b,c` | Choose which columns/fields to show. |
| `-n, --limit <n>` / `--all` | Cap results, or fetch every page. |
| `-t, --team <key>` | Set the default team for the command. |
| `-y, --yes` | Skip confirmation prompts (required for destructive actions when not a TTY). |
| `--no-input` | Never prompt; fail with a usage error instead of hanging. |
| `--no-color` · `-q, --quiet` · `--debug` | Disable color · silence status output · verbose errors. |

**JSON contract** (stable — scripts can rely on it): a list is a **bare array**, a single
resource is a **bare object**, and an error is `{"error":{"message","code"}}` on **stderr**.
Status/progress text always goes to stderr, never stdout.

**Exit codes:** `0` ok · `1` runtime/API · `2` usage · `3` not-found/ambiguous · `4` auth ·
`5` rate-limited.

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
pnpm verify           # typecheck + lint + unit/contract tests
pnpm test:live        # live integration tests (needs LINEAR_API_KEY + LINEAR_CLI_LIVE=1)
pnpm test:live:admin  # also runs admin-tier suites (e.g. team create/update)
pnpm audit:coverage   # regenerate COVERAGE.md (add --update to re-baseline the snapshot)
pnpm janitor          # sweep leaked `clitest-` fixtures from the test workspace
```

Architecture is three layers — **commands** (commander wiring) → **services** (one module per
resource, the only place that touches the SDK) → **`@linear/sdk`**. The machine JSON envelope is
locked and contract-tested so output never silently drifts.

> Live integration tests run against a real workspace and share one API key; running the entire
> suite repeatedly can hit Linear's rate limit. Run a subset (a few files at a time) or re-run
> after a short pause if you see transient rate-limit failures.

## License

[MIT](./LICENSE) © Eugene Beloded
