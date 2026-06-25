# linear-sdk-cli

An ergonomic command-line interface for [Linear](https://linear.app), built on the
official [`@linear/sdk`](https://www.npmjs.com/package/@linear/sdk). Human-friendly tables
by default, machine JSON (`--json`) everywhere for scripts and agents, and git-branch
awareness so the "current issue" is inferred from your branch name.

> Status: in active development. See [PLAN.md](./PLAN.md) for the roadmap and
> [COVERAGE.md](./COVERAGE.md) for SDK coverage.

## Install (development)

```sh
pnpm install
pnpm build
node dist/bin/linear.js --help      # or: pnpm dev -- --help
```

## Authentication

The CLI needs a Linear API key (Settings → Security & access → Personal API keys).
Resolution order: `--api-key` flag → `LINEAR_API_KEY` env → user config
(`~/.config/linear/config.toml`, written `0600`). The key is **never** read from a
project-local `.linear.toml`, so it can't be committed by accident.

```sh
export LINEAR_API_KEY=lin_api_xxx
# or persist it:
linear auth login
linear auth status      # shows the source; key is redacted
linear whoami
```

## Output

- Default: aligned, colorized tables / detail blocks (color auto-disables when piped).
- `--json`: the only thing written to stdout is machine JSON — lists are bare arrays,
  a single resource is a bare object, errors are `{"error":{"message","code"}}` on stderr.
- `--fields a,b,c` selects columns. `--limit N` / `--all` control pagination.

## Commands (Phase 0)

| Command | Description |
| --- | --- |
| `linear whoami` | Show the authenticated user + organization |
| `linear auth login\|status\|logout` | Manage the stored API key |
| `linear config` | Show resolved configuration (secrets redacted) |
| `linear api <query>` | Raw GraphQL escape hatch (query/mutation, stdin, vars, `--paginate`) |
| `linear completion <bash\|zsh\|fish>` | Shell completion script |

More command groups (issues, teams, projects, …) land in subsequent phases.

### Raw API examples

```sh
linear api '{ viewer { id name } }'
linear api 'query($id:String!){ issue(id:$id){ title } }' --var id=TES-1
echo '{ teams { nodes { key name } } }' | linear api --query-file -
linear api --query-file q.graphql --vars-file vars.json --paginate
```

## Configuration file

Non-secret settings can live in `~/.config/linear/config.toml` or a project `.linear.toml`:

```toml
team = "TES"          # default team key
workspace = "acme"    # url slug (display only)
sort = "priority"     # issue list sort
vcs = "git"
```

## Development

```sh
pnpm verify           # typecheck + lint + unit/contract tests
pnpm test:live        # live integration tests (needs LINEAR_API_KEY + LINEAR_CLI_LIVE=1)
pnpm audit:coverage   # regenerate COVERAGE.md
```
