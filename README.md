# linear-sdk-cli

An ergonomic command-line interface for [Linear](https://linear.app), built on the
official [`@linear/sdk`](https://www.npmjs.com/package/@linear/sdk). Human-friendly tables
by default, machine JSON (`--json`) everywhere for scripts and agents, and git-branch
awareness so the "current issue" is inferred from your branch name.

Modeled on [`schpet/linear-cli`](https://github.com/schpet/linear-cli) (human-first,
git-aware) with the agent-friendly JSON discipline of
[`linearis`](https://github.com/linearis-oss/linearis).

## Install (development)

```sh
pnpm install
pnpm build
node dist/bin/linear.js --help      # or: pnpm dev -- --help
```

Binaries: `linear` (primary) and `lin` (alias).

## Authentication

A Linear API key is required (Settings → Security & access → Personal API keys).
Resolution order: `--api-key` flag → `LINEAR_API_KEY` env → user config
(`~/.config/linear/config.toml`, written `0600`). The key is **never** read from a
project-local `.linear.toml`, so it can't be committed by accident.

```sh
export LINEAR_API_KEY=lin_api_xxx
linear auth login        # or persist it interactively
linear auth status       # shows the source; key is redacted
linear whoami
```

## Output & global flags

- **Default:** aligned, colorized tables / detail blocks (color auto-disables when piped).
- **`--json`:** the only thing on stdout is machine JSON — lists are bare arrays, a single
  resource is a bare object, errors are `{"error":{"message","code"}}` on stderr.
- `--fields a,b,c` select columns · `--limit N` / `--all` paginate · `-t/--team KEY` default
  team · `-y/--yes` skip confirmations · `--no-input` never prompt · `--debug` verbose errors.
- **Exit codes:** `0` ok · `1` runtime/API · `2` usage · `3` not-found/ambiguous · `4` auth ·
  `5` rate-limited.

Friendly inputs are accepted everywhere: issue identifiers (`TES-123`), team keys (`TES`),
state by name or type, assignee as `me`/email/name, labels/projects/cycles/milestones by name.

## Command groups

| Group | Highlights |
| --- | --- |
| `issue` (`i`) | `view/list/search/create/update/delete/archive`, `start` (git branch), `assign/state/label/comment(s)`, `relation`, `subscribe`, `id/title/url/branch` |
| `team` (`t`) | `list/view/members/states/labels/cycles/create/update` |
| `project` (`p`) | `list/view/create/update/archive/milestones/updates` |
| `milestone` (`m`) | `list/view/create/update/delete` |
| `cycle` (`c`) | `list/view/current/create/update` |
| `user` (`u`) | `list/view/me` |
| `label` (`lb`) | `list/create/update/delete` |
| `state` (`st`) | `list/view` (workflow states) |
| `comment` (`cm`) | `list/add/reply/update/delete/resolve/unresolve` |
| `document` (`doc`) | `list/view/create/update/delete` |
| `attachment` (`at`) | `list/create/delete` |
| `favorite` (`fav`) | `list/add/remove` |
| `initiative` (`init`) | `list/view/create/update/archive/delete` |
| `roadmap` (`rm`) | `list/view/create/update/delete` *(roadmaps are deprecated by Linear; reads work, mutations return a deprecation notice)* |
| `notification` (`notif`) | `list/read/unread/read-all/archive/snooze` |
| `organization` (`org`) | `view/members/invites` |
| `webhook` (`wh`) | `list/view/create/update/delete` |
| top-level | `whoami`, `auth`, `config`, `api`, `completion` |

Run `linear <group> --help` for the full options of any group. In a git repo, bare `linear`
(and `linear issue`) shows the issue inferred from the current branch.

### Examples

```sh
linear issue list --assignee me --state started          # my in-progress issues
linear issue create --title "Fix login" --team TES -P 2  # priority High
linear issue start TES-42 --move                         # branch + move to started
linear issue comment TES-42 "shipped, please review"
linear project list --team TES
linear label create --name Bug --color "#EB5757" --team TES
linear webhook create --url https://example.com/hook --resource Issue --resource Comment
linear issue view --json | jq '.identifier'
```

## Raw API escape hatch

Anything without a bespoke command is still reachable via raw GraphQL:

```sh
linear api '{ viewer { id name } }'
linear api 'query($id:String!){ issue(id:$id){ title } }' --var id=TES-1
echo '{ teams { nodes { key name } } }' | linear api --query-file -
linear api --query-file q.graphql --vars-file vars.json --paginate
```

## Coverage

Coverage of the SDK is **measured, not asserted**. `pnpm audit:coverage` enumerates every
`LinearClient` member and classifies each as `curated` (first-class command), `raw-only`
(reachable via `linear api`), or `excluded` (admin/integration/SDK plumbing), failing CI on
any drift from the committed snapshot. See [COVERAGE.md](./COVERAGE.md). Every member is
reachable — curated commands cover the core resource graph; everything else via `api`.

## Configuration file

Non-secret settings can live in `~/.config/linear/config.toml` or a project `.linear.toml`:

```toml
team = "TES"          # default team key
workspace = "acme"    # url slug (display only)
sort = "priority"     # issue list sort: priority | updated | created
vcs = "git"
```

## Development

```sh
pnpm verify           # typecheck + lint + unit/contract tests
pnpm test:live        # live integration tests (needs LINEAR_API_KEY + LINEAR_CLI_LIVE=1)
pnpm test:live:admin  # also runs admin-tier suites (team create/update, …)
pnpm audit:coverage   # regenerate COVERAGE.md (add --update to re-baseline)
pnpm janitor          # sweep leaked `clitest-` fixtures from the workspace
```

Architecture: **commands** (commander wiring) → **services** (SDK access, one module per
resource) → **`@linear/sdk`**. Commands never touch the SDK directly. The machine JSON
envelope is locked and contract-tested so scripts don't break.

## License

MIT
