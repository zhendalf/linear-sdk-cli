# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Project content, priority, labels and members.** `project create`/`update` gained
  `--content`/`--content-file` — the project's **markdown body**, which the CLI previously had no
  way to set (`--description` is the one-line summary, a different field) — plus
  `-P/--priority <0-4>` (validated locally), `-l/--label` (resolved against workspace project
  labels, deduplicated, label groups skipped), `--member` (repeatable, deduplicated),
  `--icon <name>` (a capitalized Linear icon name such as `Rocket`, validated by the API) and
  `--color <hex>`. On `update`, `--label` and `--member` replace the whole set. `project view`
  now shows Labels and Content.
- **`issue update --unassign` and `--clear-cycle`.** Clearing an assignee or removing an issue
  from its cycle was previously impossible — every flag could only set a value. Passing a clear
  flag together with its setting counterpart (`--unassign` with `--assignee`) is a usage error
  rather than a silent last-one-wins.
- **`document list --project` / `--issue`.** Documents can be narrowed to their container;
  human references (a project name, an issue identifier like `TES-1`) are resolved to ids first,
  since `DocumentFilter` matches containers by id.
- **`milestone view` lists the milestone's issues** (identifier, state, title), capped by the
  global `-n/--limit` and with an explicit `… more (use --all)` notice when the cap hides some,
  so a partial list never reads as a complete one.
- **Initiative priority and labels.** `initiative create` and `initiative update` take
  `-P/--priority <0-4>` (0 none, 1 urgent … 4 low; validated locally with a usage error) and
  `-l/--label <name>` (repeatable/comma-separated, resolved by name or id — `update --label`
  replaces the whole set, matching `issue update --label`). `initiative view` shows Priority and
  Labels, and `initiative list` gains a `Pri` column. Linear made these fields public in
  `@linear/sdk` 88.2; they were `[Internal]` before. Initiative labels are their own
  workspace-scoped entity, so name resolution goes through `initiativeLabels` and skips label
  groups, which are containers rather than applicable labels.
- **Discovery commands for scripts & agents.** `linear commands` prints a machine-readable tree
  of every (sub)command — `--json` emits a bare array of
  `{ path, description, aliases, arguments, options }` (human mode is a compact indented listing).
  `linear schema` dumps the Linear GraphQL schema as SDL (`-o, --output <file>` writes to a file;
  `--json` prints the raw introspection result), so an agent can do
  `linear schema -o /tmp/s.graphql && grep 'type Issue' /tmp/s.graphql` and then reach anything
  via `linear api`.
- **Help examples.** `issue create`/`list`/`update`/`start` and `project create` now include an
  Examples section in `--help` surfacing forgiving inputs (`--assignee me`, label-by-name,
  `--cycle current`, `--state "In Progress"`) and a `--json` recipe.

### Changed

- **`issue search` takes filters, and is now team-scoped by default.** Linear's `searchIssues`
  accepts an `IssueFilter`, so search now honors the same filters as `issue list`
  (`--state`, `--assignee`, `--project`, `--label`, `--priority`, `--cycle`,
  `--include-archived`) — including the global `-t/--team` and the configured default team.
  **This narrows the previous behavior**, where search always ran across the whole workspace:
  pass the new `--all-teams` (also available on `issue list`) to get that back. `--query` and
  `--sort` are deliberately absent from search — the term is the query, and results come back
  relevance-ordered.
- **Dependencies updated to current majors** — `@linear/sdk` 87 → 89, commander 15,
  `@inquirer/prompts` 8, TypeScript 6, eslint 10, `@types/node` 26. The Linear schema changes in
  88/89 are additive for everything this CLI touches; no command behavior changes. TypeScript is
  held at 6.x because typescript-eslint does not yet accept 7.
- **`issue archive` now confirms** before archiving, matching `issue delete` and the other
  `archive` commands. Pass `-y/--yes` (required outside a TTY). `unarchive` stays un-gated.
- **Stable `id` in mutation JSON.** Every issue mutation's `--json` output now carries the stable
  UUID `id` alongside the human `identifier`: `archive`, `unarchive`, `delete`, `subscribe`,
  `unsubscribe`. `issue relation add/remove` now emits `issueId`/`issueIdentifier` and
  `otherId`/`otherIdentifier`.
- **Bare `linear` is now consistent with `issue view`.** When an issue id is inferred from the
  branch, `linear` (and `linear --json`) produces the exact same output as `issue view <id>`.
  When no id can be inferred, `--json` fails with a usage error (so stdout is never non-JSON);
  human mode still prints help.
- **`issue view --web --json`** now emits `{ id, identifier, url, opened: true }` after opening
  the browser (previously it produced no JSON).
- **`api --paginate`** now warns on stderr when the result is truncated at the 1000-page safety
  cap (previously it stopped silently).
- **`--cycle`** uses a single metavar and description everywhere (`--cycle <n>`,
  "cycle number, id, or 'current'") across filters and create/update.

### Fixed

- **Deactivated users were invisible.** `team members` and `user list` never sent
  `includeDisabled`, which Linear defaults to `false` — so deactivated users were never returned
  and the `Active` column could only ever print `yes`. Both commands now take
  `--include-disabled` (still excluded by default), and `team members` requests a full page
  instead of relying on the server's default page size.
- **An invalid configured sort was silently ignored.** `--sort` is validated by the parser, but
  `LINEAR_ISSUE_SORT` / `sort` (`issue_sort`) in config was not: an unrecognized value fell
  through to `updatedAt` rather than the documented `priority` default, with no warning.
  Resolution now runs through a single validated path that errors with the valid values and
  names where the bad value came from (the env var, or the exact config file).
- **`issue search --json` reported no labels.** The search path hardcoded an empty label list, so
  the same field was populated by `issue list` and empty from `issue search`. Search now uses the
  same tailored query as `list` and returns an identical row — which also removes an N+1
  (state/assignee/project were fetched one issue at a time).

- **Strict `--limit`.** `--limit` now accepts only a positive integer; `--limit 0`, `--limit -1`,
  and `--limit 12x` are usage errors instead of silently falling back to the default.
- **Strict `--fields`.** An unknown `--fields` name is now a usage error listing the available
  columns, instead of silently showing all columns. (JSON output is unaffected — it stays
  complete.) Fields also match by column header, case-insensitively.

- **Status updates.** Two new command groups post and list project/initiative status updates:
  `project-update` (alias `pu`) and `initiative-update` (alias `iu`), each with `create <ref>` and
  `list <ref>` (alias `ls`). `create` takes the body from `--body`, `--body-file <path>` (`-` =
  stdin), or `--editor` ($EDITOR), and an optional `--health <onTrack|atRisk|offTrack>`; an empty
  body is a usage error. `create` emits the new update (bare object in `--json`); `list` emits the
  usual bare array. The reference (project or initiative) is resolved by name or id.
- **Git + GitHub PR workflow.** Two new issue subcommands bridge Linear and your VCS, with the
  issue id inferred from the current branch as usual. `issue describe [id]` prints the issue
  title plus a commit-message trailer using Linear's git magic words (`Fixes <ID>`, or
  `References <ID>` with `-r`/`--references`) — drop it into `git commit -m "$(linear issue
  describe)"`. `issue pull-request [id]` (alias `pr`) creates a GitHub PR via the `gh` CLI:
  the title defaults to the issue title (`--title` to override) and the body is the issue
  description followed by a `Fixes <ID>` trailer and the Linear URL, so the PR and issue
  reference each other. Flags: `--base`, `--head`, `--draft`, `--web`. The created PR URL is the
  only thing emitted to stdout (`{ url, identifier, title }` in `--json`). It never auto-pushes
  or creates branches, and fails with clear errors when not in a git repo, when `gh` is missing,
  or when `gh` itself fails.
- **Multi-workspace credentials.** Store API keys for several workspaces and switch between
  them. New `auth` subcommands: `auth list` (configured workspaces + default), `auth default
  <slug>` (set the default), and `auth token` (print the resolved key for scripting). `auth
  login` now accepts the global `--workspace <slug>` (derived from the key's organization when
  omitted) and `auth status` reports the active credential workspace. A new global
  `--workspace <slug>` selects which stored credential to use for any command. Credentials live
  in quoted `[workspaces."<slug>"]` tables under a top-level `default_workspace`. Credential
  selection follows flag/`LINEAR_API_KEY` (absolute) →
  `--workspace`/`LINEAR_WORKSPACE`/`default_workspace`, and is never steered by project
  `.linear.toml`. When several workspaces are configured with no default, the error is deferred
  until a command actually needs the API — so `auth list`/`default`/`login` still work.

### Changed

- **Bun-only distribution.** The CLI now ships as raw TypeScript and runs directly on
  [Bun](https://bun.sh) (≥ 1.1) — no build step, no bundle, no Node. Install with
  `bun add -g linear-sdk-cli`. The toolchain (install, test, run) is Bun end-to-end.
- **BREAKING: `label create --workspace` renamed to `--shared`.** The boolean that forces a
  workspace-level (shared) label collided with the new global `--workspace <slug>` credential
  selector. Use `linear label create --shared` instead.
- **BREAKING: `project updates <id>` removed.** Use `project-update list <project>` (alias
  `pu ls`), the canonical replacement, instead.
- **BREAKING: consistent date flags.** `cycle create`/`update` now take `--start`/`--end`
  (was `--startsAt`/`--endsAt`), and `initiative create`/`update` now take `--target` (was
  `--target-date`). These align with the `--target`/`--start`/`--end` already used by `project`
  and `milestone`, removing the lone camelCase pair. The accepted date/ISO values are unchanged.
- **`roadmap delete` alias is now `rm`** (was `del`), matching the `rm` delete alias used by
  every other group.

## [0.1.0]

Initial release. An ergonomic CLI for Linear built on `@linear/sdk`, with human-readable output
by default and a stable `--json` mode for scripts and agents.

### Added

- **Issues** — view, list, search, create, update, delete, archive/unarchive, `start`
  (git-branch checkout + optional state move), assign, state transitions, label management,
  comments, relations (both directions), subscribe/unsubscribe, and `id`/`title`/`url`/`branch`
  helpers. Git-branch awareness infers the current issue from the branch name.
- **Teams, projects, milestones, cycles** — listing, detail, and CRUD where appropriate.
- **Users, labels, workflow states, comments, documents, attachments, favorites** — the
  supporting resource graph.
- **Initiatives, roadmaps, notifications, organization, webhooks** — extended resources.
- **`linear api`** — raw GraphQL escape hatch (query/mutation from arg/file/stdin, variables,
  named operations, `--paginate`).
- **Config & auth** — hierarchical config (`.linear.toml` + env + flags) with a strict API-key
  boundary (never read from project files) and redaction.
- **Shell completion** for bash, zsh, and fish.
- **Coverage audit** classifying every `LinearClient` member, gated against a committed snapshot.
