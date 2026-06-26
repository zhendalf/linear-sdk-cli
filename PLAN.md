# Linear CLI — Implementation Plan

> **Design document / project history.** This is the original implementation plan the project
> was built against (reviewed before any code was written). For usage and installation see
> [README.md](./README.md); for SDK coverage see [COVERAGE.md](./COVERAGE.md). Kept for
> provenance — it may not track every later refinement.

A command-line interface for [Linear](https://linear.app) built on the official
[`@linear/sdk`](https://www.npmjs.com/package/@linear/sdk) (v87). Ergonomics
modeled on [`schpet/linear-cli`](https://github.com/schpet/linear-cli) (human-first,
git-branch-aware, dual human/JSON output) with the agent-friendly JSON discipline of
[`linearis`](https://github.com/linearis-oss/linearis).

## 1. Goals & scope

- **Primary goal:** ergonomic, scriptable CLI that surfaces the functionality exposed by
  the Linear SDK, end-to-end, thoroughly tested against a live workspace.
- The SDK exposes ~460 client members (194 mutations, 266 queries). A 1:1 command map
  would be unusable. Strategy: **first-class commands for the core resource graph**
  (issues, teams, projects, milestones, cycles, comments, users, labels, workflow states,
  documents, attachments, favorites, initiatives, roadmaps, notifications, organization,
  webhooks), **plus a capable `api` raw-GraphQL escape hatch** so anything without a
  bespoke command is still reachable.
- **Coverage is measured, not asserted.** `api` gives GraphQL coverage, *not* SDK-member
  coverage — they are different things. A generated **coverage audit** (`scripts/coverage-audit.ts`
  → `COVERAGE.md`) inventories every SDK client member and classifies each as
  `curated` (has a bespoke command), `raw-only` (reachable via `api`, intentionally not
  wrapped), or `excluded` (internal/deprecated/admin/enterprise-only, with reason). The
  audit runs in **Phase 0** and is refreshed every phase; CI fails if a member is
  unclassified. This is how we make the coverage claim honest.
- Dual output: rich human tables/detail by default; `--json` everywhere for agents/scripts.
- Git-branch awareness: infer the "current issue" from the branch name (`tes-123-foo` → `TES-123`).

## 2. Tech stack & tooling

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript (strict), ESM | Matches SDK; type safety across command surface |
| Runtime | Node ≥ 18 (dev/test on Node 22) | SDK requires `>=18`; matches user env |
| CLI framework | **commander** | Mature, ergonomic nested subcommands, auto-help/usage, low overhead |
| Config | `.linear.toml` (hierarchical) + env vars | Mirrors schpet; `smol-toml` parser |
| Tables | small in-house formatter (no heavy dep) | predictable widths, color via `picocolors` |
| Prompts | `@inquirer/prompts` | interactive `create`/`start` flows |
| Build | **tsup** (esbuild) → single ESM bundle + shebang bin | fast, simple |
| Test | **vitest** | unit (mocked SDK) + live integration (gated by env) |
| Lint/format | eslint + prettier | consistency |
| Pkg mgr | pnpm | user default |

Binary names: `linear` (primary) and `lin` (alias). Package: `linear-sdk-cli`.

## 3. Architecture

Three layers: **commands** (commander wiring, arg/flag parsing, output) →
**services** (resource operations, SDK calls, payload unwrapping; testable in isolation) →
**SDK**. Commands never call the SDK directly; they go through services. Shared option
factories keep flags consistent across the ~20 command groups.

```
src/
  bin/linear.ts            # shebang entry → builds program, parses argv, error boundary
  cli.ts                   # root commander program; registers all command groups; global opts
  client.ts                # LinearClient factory from resolved config; rate-limit/error normalization
  config.ts                # config resolution: flags > env > .linear.toml (cwd→ancestors) > user dir
  context.ts               # per-invocation context: client, config, output mode, color, isTTY
  git.ts                   # branch parsing → issue identifier; branch creation helpers
  output/
    format.ts              # print(): human vs json; JSON envelope contract; success/err
    table.ts               # column layout, truncation, color, --fields/--columns selection
  lib/
    options.ts             # shared option factories (pagination, fields, common filters, --yes)
    resolve.ts             # resolve human inputs → ids (team key→id, state name→id, "me"/email→id…)
    pagination.ts          # iterate SDK connections (fetchNext) up to --limit / --all
    errors.ts              # CliError, error normalization (rate-limit, auth, validation), exit codes
    body.ts                # body resolution: arg | --body-file | stdin | $EDITOR
    prompt.ts              # interactive prompts; refuse on non-TTY unless flags supplied
  services/                # one module per resource: issue, team, project, milestone, cycle,
                           # comment, user, label, state, document, attachment, favorite,
                           # initiative, roadmap, notification, organization, webhook
  commands/                # one module per group; mirrors services/; plus api.ts, completion.ts
  index.ts                 # programmatic export (createProgram)
scripts/
  coverage-audit.ts        # enumerate SDK members → COVERAGE.md; CI gate on unclassified
test/
  unit/                    # config, git parsing, formatting, resolve, services (mocked SDK)
  contract/                # --json output shape snapshots (stable envelope)
  integration/             # live workspace, gated by LINEAR_API_KEY + LINEAR_CLI_LIVE=1
  janitor.ts               # cleanup leaked fixtures (prefix-scoped); run if afterAll misses
```

### Cross-cutting conventions
- **Global flags:** `--json`, `--no-color`, `--api-key <key>`, `--team <key>`, `--limit <n>`,
  `--all`, `--fields <a,b,c>`, `-y/--yes`, `-q/--quiet`, `--debug` (stack traces + raw GraphQL errors).
- **JSON envelope contract (locked now — scripts depend on it):** `--json` writes *only*
  machine JSON to stdout. **Lists → a bare JSON array** of objects (jq-friendly, linearis-style);
  **single resource → a bare object**; **mutations → the affected object** (or `{success:true,id}`
  when there is no resource body). **Errors → `{"error":{"message","code"}}` on stderr** + non-zero
  exit. No `{data,meta}` wrapper. Pagination metadata, when needed, goes to stderr, never stdout.
  Contract tests snapshot these shapes so they never silently drift.
- **Human mode:** tables/detail to stdout, progress/status to stderr.
- **ID resolution helpers:** accept friendly inputs everywhere — issue identifier `TES-123`,
  team key `TES`, state by name, assignee `me`/email/name, label by name, project/cycle by name.
- **Body input:** `create`/`update`/`comment` accept body as positional arg, `--body-file <path>`
  (`-` = stdin), or `$EDITOR` when interactive and omitted.
- **Non-TTY:** interactive prompts are only used when stdin is a TTY; otherwise missing required
  input is a usage error (exit 2), never a hang. `--no-input` forces non-interactive.
- **Exit codes:** `0` ok, `1` runtime/API error, `2` usage error, `3` not found/ambiguous,
  `4` auth, `5` rate-limited (after retry/backoff exhausted).
- **Pagination:** default page (e.g. 50), `--limit N`, `--all` to exhaust via `fetchNext`.
- **Mutations:** unwrap SDK payloads (`{ success, issue }`); destructive ops confirm unless `-y/--yes`
  (and require `--yes` when non-TTY).
- **API errors normalized** in one place (`client.ts`/`errors.ts`): auth, validation, rate-limit
  (with `Retry-After`/backoff), network — each mapped to a stable code + exit code.

## 4. Command surface (target)

> `linear <group> <command> [args] [flags]`. Groups aliased where ergonomic.

### issue (alias: `i`) — git-aware current-issue default
- `view [id]` (default current branch) · `--web`/`--app` to open · `--comments`
- `id` · `title` · `url` · `branch` (print/copy suggested branch name)
- `list` (alias `ls`) — filters: `--assignee`, `--state`, `--team`, `--project`, `--milestone`, `--label`, `--cycle`, `--priority`, `--query`, `--sort`, `--include-archived`
- `search <text>` — full-text (`searchIssues`)
- `create` — `--title --description --team --assignee --state --priority --label --project --milestone --estimate --parent`; interactive when flags omitted; `--editor` for body
- `update [id]` — same fields + `--add-label/--remove-label`
- `start [id]` — checkout git branch (from `issue.branchName`); also moves issue to a started
  state **only with `--state` / `--move`** (the mutation is opt-in and explicit, never implicit);
  `--no-checkout` to skip git
- `assign [id] <assignee>` · `state [id] <state>` (transition) · `comment [id] [body]`
- `archive/unarchive [id]` · `delete [id]` (confirm) · `subscribe/unsubscribe [id]`
- `label [id] --add/--remove` · `links` (attachments)
- `relation <id> <add|remove|list> [--blocks|--blocked-by|--related|--duplicate <other>]`
- Default behavior: bare `linear issue` (and bare `linear`) → `issue view` of the current branch
- Bulk: `--query`/filters + actions accept multiple ids where the SDK supports batch
  (`issueBatch` for update); otherwise iterate with a summary report

### team (alias: `t`)
- `list` · `view [key]` · `members [key]` · `states [key]` · `labels [key]` · `cycles [key]`
- `create` · `update [key]`

### project (alias: `p`)
- `list` (filter `--team --state`) · `view <id|name>` · `create` · `update` · `archive`
- `milestones <project>` · `updates <project>` (project updates)

### milestone (alias: `m`)
- `list <project>` · `view <id>` · `create <project>` · `update <id>` · `delete <id>`

### cycle (alias: `c`)
- `list [team]` · `view <id>` · `current [team]` · `create [team]` · `update <id>`

### comment
- `list <issue>` · `add <issue> <body>` · `reply <commentId> <body>` · `update <id>` · `delete <id>` · `resolve/unresolve <id>`

### user (alias: `u`)
- `list` · `view <me|id|email>` · `me`

### label
- `list [team]` · `create` · `update <id>` · `delete <id>`

### state (workflow states)
- `list <team>` · `view <id>`

### document (alias: `doc`)
- `list` · `view <id>` · `create` · `update <id>` · `delete <id>`

### attachment
- `list <issue>` · `create <issue> --url --title` · `delete <id>`

### favorite
- `list` · `add` · `remove <id>`

### initiative
- `list` · `view <id>` · `create` · `update <id>` · `delete <id>`

### roadmap
- `list` · `view <id>` · `create` · `update <id>` · `delete <id>`

### notification
- `list` · `read <id>` · `read-all` · `archive <id>` · `snooze <id>`

### organization (alias: `org`)
- `view` · `update` (limited) · `members`/`invites`

### webhook
- `list` · `create --url --resource` · `update <id>` · `delete <id>`

### Top-level
- `whoami` (viewer) · `auth login|status|logout` (store key in user config dir) ·
  `config` (show resolved config, **secrets redacted**) ·
  `completion <bash|zsh|fish>` · `--version`/`-V`.
- **`api` (raw GraphQL escape hatch — first-class, lands in Phase 0):**
  - `linear api <query>` | `--query-file <path>` | reads from **stdin** when no query given
  - `--var k=v` (repeatable) and `--vars-file <json>` / `--vars '<json>'` for variables
  - `--operation <name>` to select a named operation in a multi-op document
  - `--paginate` to auto-follow connection `pageInfo.endCursor` (injects `$after`), merging `nodes`
  - raw GraphQL errors passed through to stderr as the normalized error envelope; data → stdout
  - `--raw` to print the full GraphQL response (including `extensions`) unmodified
  - supports both queries and mutations; `--help` shows worked examples

## 5. Configuration & auth

**Non-secret settings** resolution order (highest first): CLI flag → env var → project
`.linear.toml` (cwd then ancestors) → user config (`~/.config/linear/config.toml`).
Keys: `LINEAR_TEAM` (default team key), `LINEAR_WORKSPACE` (url slug — also auto-detected
from org via `viewer`/`organization`), `LINEAR_ISSUE_SORT`, `LINEAR_VCS` (git, default).

**Auth (the API key) has stricter boundaries** — it is *never* read from project-local
`.linear.toml` (avoids committing secrets): only `--api-key` flag → `LINEAR_API_KEY` env →
user config (`~/.config/linear/config.toml`, written `0600`) → [optional, deferred] OS keychain.
`auth login` writes to user config; `auth status` reports source without printing the key;
`config` output **redacts** the key (`lin_api_••••cw`).

**Workspace model:** the API key alone determines the active workspace/identity; `LINEAR_WORKSPACE`
is display/URL-building only and is validated against the org returned by the key (warn on mismatch).

## 6. Testing strategy

- **Unit (always run, mocked):** config resolution & precedence; git branch→identifier
  parsing (and edge cases); table/JSON formatting & truncation; input→id resolvers; body
  resolution; pagination iterator; service logic; arg parsing per command. Mock `LinearClient`.
- **Contract (always run):** snapshot the `--json` envelope shape (array/object/error) per
  command so the machine-facing output never silently drifts.
- **Live integration (gated by `LINEAR_API_KEY` + `LINEAR_CLI_LIVE=1`):** spawn the built CLI
  against `test-workspace-bla` (team `TES`), parse `--json`, true end-to-end. Realities baked in:
  - **run serially** (`--no-file-parallelism`) to avoid cross-test interference and rate limits;
  - **unique fixture prefix** per run (e.g. `clitest-<runid>-`) so leaks are identifiable;
  - **retry/backoff** wrapper for rate-limit (429) responses;
  - **tiered suites:** `core` (issues/comments/labels/projects/cycles — safe CRUD, always run live),
    and `admin` (teams create/delete, webhooks, org, notifications — **opt-in** via
    `LINEAR_CLI_LIVE_ADMIN=1`, since they may be permission-limited/destructive/flaky);
  - cleanup in `afterEach`/`afterAll` **and** a standalone `test/janitor.ts` that sweeps any
    fixture matching the prefix (because `afterAll` is not guaranteed to run).
- **CI-style scripts:** `pnpm verify` = typecheck + lint + unit + contract; `pnpm test:live`
  (core) and `pnpm test:live:admin`; `pnpm audit:coverage` regenerates `COVERAGE.md` and fails
  on unclassified members; `pnpm janitor` cleans leaked fixtures.
- Manual smoke at each phase using the real key before codex review.

## 7. Phasing (codex-reviewed; commit per phase)

- **Phase 0 — Scaffolding/core + escape hatch:** tooling, config/auth (with redaction +
  strict key boundaries), client factory + error/rate-limit normalization, output layer +
  JSON envelope + contract tests, global flags & shared option factories, `whoami`/`auth`/`config`,
  **the full `api` raw-GraphQL command**, and **`scripts/coverage-audit.ts` → `COVERAGE.md`**.
  The escape hatch + audit land first so coverage is measurable and every later resource is
  reachable from day one. Tests for config/format/git/api/coverage.
- **Phase 1 — Issues:** full issue group + git branch awareness + resolvers + body input +
  relations + bulk. Live CRUD tests. Refresh `COVERAGE.md`.
- **Phase 2 — Teams/Projects/Milestones/Cycles.** Live tests (`admin`-tiered where needed).
- **Phase 3 — Comments/Users/Labels/States/Documents/Attachments/Favorites.** Live tests.
- **Phase 4 — Initiatives/Roadmaps/Notifications/Organization/Webhooks + completions + README +
  final coverage audit.** Live tests + full-surface audit (every SDK member classified).

Each phase: implement → unit + contract + live tests green → coverage audit refreshed →
**codex review** → address → **commit**.

## 8. Decisions (defaults chosen post-review; override on request)

1. **Framework = commander** — risk (option drift across many commands) mitigated by shared
   option factories from the start.
2. **Coverage = curated commands + capable `api` escape hatch + a generated, CI-gated audit**
   (`COVERAGE.md`) that classifies every SDK member. Honest, measurable coverage — not a 1:1
   map of 460 members.
3. **Human output by default**, `--json` opt-in with a **locked envelope** (bare array/object;
   `{error}` on stderr).
4. **Binary name:** primary `linear`, alias `lin`. (Aliasing doesn't fully fix shadowing; if an
   existing `linear` on PATH is a concern we can rename — flagged for the user.)
5. **Auth never stored in project files**; user config `0600` + env + flag; keychain deferred.
6. **`issue start` mutation is explicit** (`--state`/`--move`), branch checkout by default.
7. Interactive prompts only on TTY; otherwise usage error (no hangs). Completion generation is
   unit-tested, not just hand-checked.

## 9. Review note

This plan incorporates a codex review pass (coverage audit honesty, earlier+richer `api`,
service layer + option factories, stricter auth boundaries, realistic tiered live-test matrix,
locked JSON envelope, non-TTY behavior). See git history / conversation for the raw review.
