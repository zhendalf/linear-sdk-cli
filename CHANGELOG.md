# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The query filters a script carried over from `linear-cli` expects.** These failed loudly before
  (unknown flag), so nothing changes meaning — but they blocked real workflows, and every one of
  them is now on `issue list`, `issue mine` and `issue search` alike, because all three share one
  filter builder.
  - **`-U/--unassigned`** — issues with no assignee (`assignee: { null: true }`). Combining it with
    `--assignee` is a usage error rather than a silent winner: "unassigned issues assigned to Ada"
    is not a question with an answer.
  - **Repeatable `--team` and `--state`.** Both broaden, which is the opposite of repeated
    `--label` (which narrows) — and deliberately so: an issue belongs to exactly one team and sits
    in exactly one state, so intersecting them would build a filter that can never match. A single
    `--team`/`--state` sends the exact filter it always did (`key: { eq }` / `type: { eq }`);
    several send `key: { in: [...] }` and an `or` of state clauses. `--state` keeps taking a state
    *name* or a state *type*, mixed freely: names stay individual `eqIgnoreCase` clauses because
    `in` is exact-case, so `--state 'in progress'` still matches "In Progress".
    `--team` is repeatable **only on the three issue queries**. It is a global option that ~135
    commands use for something other than filtering — the team an issue is created in, the team a
    cycle or workflow state belongs to — where "several teams" has no meaning, so making the global
    itself a list would push an array through every one of those call sites to no benefit. The
    queries declare their own repeatable `--team`, and the global-option injection now leaves a
    locally-declared global alone instead of overwriting it (which would have quietly kept the last
    key only). `issue mine`'s "unstarted by default" now travels through this same `--state` field
    rather than a second one, so there is one state path in the filter builder, not two.
  - **`--created-after` / `--updated-after`** — inclusive (`gte`) bounds taking `YYYY-MM-DD` or full
    ISO 8601. The date is validated locally first: `new Date()` accepts "1", "March 2024" and
    "yesterday", and a garbage bound is not an API error but an empty result set — a filter that
    silently matches nothing looks exactly like a query with no matches.
  - **`--project-label`** — every issue whose *project* carries a label, matched case-insensitively
    (`--project-label backend` finds the "Backend" label). Mutually exclusive with `--project`:
    one names a single project, the other a set of them.
  - **`--search-comments`** (`issue search` only) — match comment bodies as well as titles and
    descriptions. It rides on `searchIssues`' own `includeComments` argument rather than the shared
    filter, because the plain `issues` query has nowhere to put it; that is also why it is absent
    from `issue list`/`mine`. Off by default, as in the reference: comment text widens a search a
    lot, and you should be able to ask for that rather than discover it.
  - **`--milestone`** — filter by project milestone, by name or id. The reference CLI requires
    `--project` alongside it; Linear's `IssueFilter` does not, so here that scoping is optional and
    only changes precision: with `--project` the name is resolved to a milestone id inside that
    project, without it the milestone is matched by name across projects. A transplanted command
    always passes `--project` and behaves identically either way.
- **`issue update --team <key>` now actually moves the issue between teams** (AUDIT.md #8: the flag
  was accepted and silently dropped — alone it produced a misleading "Nothing to update", and
  alongside another flag it moved nothing at all). Everything team-scoped in the same command is
  resolved against the **destination** team, so `issue update TES-42 --team ENG --state 'In Review'`
  means ENG's "In Review": the state id of the team the issue is leaving is not valid in the team
  it is joining, and the API rejects the pair with "Discrepancy between issue team and state, cycle
  or project" (verified). What Linear does to the rest of the issue was verified live rather than
  assumed — it needs no clearing from us, because it remaps server-side: the workflow state is
  carried over to the destination team's equivalent state, the **cycle is dropped** (cycles are
  team-scoped), **team-scoped labels are dropped** while workspace-level labels survive, and a
  **project the destination team is not part of is dropped** along with its milestone. The assignee
  survives, and the issue is renumbered (`TES-489` → `CLM-2`), which human output now says out loud
  so the next command in a script does not go looking for an identifier that no longer exists.

- **Aliases for the reference `linear-cli`'s spellings.** Everything below is purely additive:
  no existing flag, command, or output changed meaning. The goal is that a script or a habit
  carried over from `linear-cli` keeps working instead of failing on a spelling.
  - **Short flags.** `-j` for the global `--json` (the reference's most-used flag, on 17 of its
    commands) and `-w` for `--web` on `issue view` / `issue pull-request`. Both letters were
    free in our tree, so neither costs an existing meaning — we still hold one meaning per
    letter everywhere, which is exactly why we are *not* adopting their `-t`/`-p`/`-a`/`-l`/`-s`
    (see `ALIGNMENT.md`: their own tree spells `-t` as both `--title` and `--team`).
  - **Long-flag spellings.** `--due-date` (`issue create`/`update`), `--target-date` (`project`,
    `milestone`, `initiative` create/update), `--start-date` (`project create`/`update`),
    `--search` (`issue list`/`mine`), and `--all-states` on `issue list`, where it is the
    no-op it describes — `list` already spans every state. Aliases are registered *hidden*, so
    `--help` and `linear commands --json` keep advertising exactly one spelling per flag; the
    full mapping lives in README's "Coming from linear-cli". Passing both spellings at once is a
    usage error rather than a silent pick: `--due 2026-01-01 --due-date 2026-02-01` is not a typo
    anything should be guessing at. `project list --status`, which shipped earlier as a visible
    duplicate option, now goes through this same mechanism.
  - **Accepted values.** `self` joins `me`/`@me` as the viewer sentinel anywhere a user is named,
    so `--assignee self` assigns to you instead of hunting for a user called "self".
    `--limit 0` is accepted as a synonym for `--all` — it used to be a usage error, and the
    silent-failure risk is the opposite direction: a transplanted `--limit 0` that quietly
    returned the 50-row default would look like a complete result. `--all` stays the spelling we
    teach. Cycles now resolve by **name** as well as number/id, and `active` is accepted
    alongside `current` — the union of both CLIs' vocabularies, so no cycle reference from
    either side is rejected.
  - **Command aliases.** `issue query` (their name for this listing) runs the same command object
    as `issue list`; `auth whoami` runs the identical handler as our top-level `whoami`; and
    `issue comment` gained `add`/`list`/`update`/`delete` subcommands mounted on the same
    handlers as the top-level `comment` group, so there is one implementation, not two.
    `issue comment <id> <body>` is unchanged — commander only dispatches to a subcommand when
    the *first* operand is one of those four names, which is the one behavior this touches: a
    lone `linear issue comment add` used to mean "comment the word 'add' on the branch's issue"
    and now reaches the subcommand (and says so loudly). The short aliases `ls`/`edit`/`rm` are
    deliberately not registered under `issue comment`, to keep that collision at four words.
- **`issue mine` — your unstarted work.** The reference `linear-cli` makes this its
  *default* listing (`issue list` there is an alias of `mine`), so a script or a habit carried
  over from it silently saw only your own unstarted issues. We keep `list` general — a command
  named "list" should list — and add `mine` next to it with the reference's defaults: the
  viewer's issues, restricted to `unstarted` states, widened by `--all-states`. It takes the same
  filters as `issue list` minus `--assignee`, which would make the command's name a lie. Same
  service path as `list`, so the JSON contract and `--fields`/`--limit` behave identically.
  It deliberately does **not** take the reference's `l` alias: `list` is `ls` here, so `l` and `ls`
  would sit one keystroke apart and return completely different sets.
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

- **Repeating `--label` now narrows instead of broadening.** `--label bug --label regression`
  used to return issues carrying *either* label; it now returns only those carrying *both*.
  Every other repeatable filter in this CLI narrows, the reference CLI narrows, and the broadening
  reading was the surprising one — a ported script got a superset of what it asked for and no
  error to notice. A single `--label` is unchanged, and both forms stay case-insensitive.
  Implemented as `labels: {and: [{some: …}, …]}` — one `some` per label, because a single `some`
  wrapping an `and` would require one label to be named two things at once and match nothing.
- **`--sort priority` orders by workflow state first.** It was priority alone, which interleaved
  states and floated a backlog item above work that is actually in progress. The order is now
  workflow state **ascending** (active work above the backlog), then priority descending
  (no-priority last), then manual ascending. Membership is unchanged; only the ordering moved.
  `--sort updated` and `--sort created` (which the reference lacks) are untouched.
  The reference CLI hardcodes state *descending* for this flag, which the API answers with Backlog
  **before** In Progress — a Low-priority backlog item outranks an Urgent in-progress one there.
  We match the intent (state-grouped, UI-like) rather than that payload; verified against the API.
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

- **`project list --state` filtered nothing at all.** It built `state: {eq: …}`, which targets
  Linear's deprecated legacy `Project.state` field — the API silently ignores it, so every value,
  valid or not, returned the complete unfiltered list. It now matches the project's status by
  **name or type**, case-insensitively (`--state 'In QA'` and `--state started` both work), and
  `--status` is accepted as an alias for the same thing.
- **`issue list --label` was case-sensitive.** The filter used an exact-case `in` comparator, so
  `--label bug` returned an empty list when the label is stored as `Bug` — wrong results with no
  error, while label *resolution* everywhere else matches case-insensitively. (Repeating the flag
  now narrows the match — see Changed.)
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
