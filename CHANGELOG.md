# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Credentials in the OS keyring, and schpet/linear-cli's found without a re-login.**
  `auth login` now stores the API key in the macOS Keychain (or Linux `secret-tool`) under service
  `linear-cli` / account `<workspace slug>` — the reference CLI's exact convention — and writes only
  a `keyring = true` marker to `config.toml`; `--plaintext` keeps today's `0600` file behaviour,
  and a platform with no keyring falls back to it silently (a platform is not an error). Resolution
  falls through to the keyring after the flag, the env and a plaintext `api_key`, and `auth status`
  reports `Source: keychain`. A user coming from schpet 2.x is authenticated before their first
  command: their `credentials.toml` workspace list and `default` are read (never its inline keys),
  and the Keychain item is where we look. New `auth migrate` moves every plaintext key from the
  file into the keyring, all-or-nothing with rollback; `auth list` gains a `Storage` column;
  `auth logout` removes the keyring entry too, and drops the slug from schpet's list so neither
  tool advertises a workspace whose key is gone. The secret never travels on argv: macOS goes
  through `security -i` (commands over stdin — `add-generic-password -w` as the last option
  prompts on `/dev/tty` and hangs in a real terminal, verified), Linux through `secret-tool`'s
  stdin. `auth login --key -` reads the key from stdin; `--key <value>` warns that argv is
  visible to other processes.
- **Config discovery now covers every file schpet/linear-cli reads.** We looked only for
  `.linear.toml` up the tree and `~/.config/linear/config.toml`, so a repo configured with its
  `linear config` — which prefers `<git root>/.config/linear.toml` — and a user's global
  `~/.config/linear/linear.toml` were both invisible: `issue create` said "No team specified" and
  every list widened to the workspace. The project walk now checks `linear.toml`, `.linear.toml`
  and `.config/linear.toml` in each directory from cwd up, in its order (it looks at cwd and the
  git root; every directory between is a superset that agrees wherever it would find something),
  and its global `linear.toml` is read as the lowest tier for non-secret settings — never for the
  `api_key` it allows there, same rule as a project file. `linear config` now prints each value with
  the tier and file it came from (`Team: TES (project: /repo/.config/linear.toml)`), and the JSON
  carries `origins` and `globalConfigPath`.
- **`config init` and `config set` — the config was read-only, so a project's `.linear.toml` had to
  be written by hand.** `config init` writes `<git root>/.linear.toml` (or `./.linear.toml` outside
  a repository; `--path` to choose), taking `--team` or offering the workspace's teams in a prompt;
  it refuses to replace an existing file without `--force`. `config set <key> <value>` changes one
  of `team`, `workspace`, `sort`, `vcs` in the project config discovery would actually read — a
  schpet-written `.config/linear.toml` included, in *its* spelling (`team_id`, `issue_sort`), so no
  second competing key appears — or, with `--user`, in `~/.config/linear/config.toml`. The edit is
  textual, one line replaced or appended before the first table, so comments and layout survive;
  the result is parsed back to prove it, falling back to a full re-serialize only if a layout we
  did not foresee defeats the line edit. Values are checked the way the reader will judge them
  (`sort manual` is refused here, not on the next `issue list`), keys that belong to the credential
  store (`api_key`, `workspaces`, …) are refused with a pointer to `auth login`, and every write
  is atomic. Bare `linear config` still shows the resolved configuration (it is `config show`).

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

- **`--fields` is one projection, applied and validated in both modes** (TES-635 (1)). It was
  validated only in human list mode — `--fields nope --json` exited 0 with every key while
  `--fields nope` exited 2 — ignored on detail views entirely, and able to pick only among the
  table's default columns although the row carried more (`issue list --fields id,title,labels` was
  `Unknown field 'labels'`). Now: on a human table, a field is a column key/header **or any row
  key** (`labels`, `project`, `url`, `updatedAt`, …), rendered readably (arrays comma-joined, a
  relation object by its name); on a human detail block, a field is one of its labelled lines
  (`--fields state,url`); under `--json`, a field is a top-level key of the object(s), kept in the
  order asked (`issue list --fields identifier,state --json` → `[{identifier, state}]`) — smaller
  payloads for an agent that wants three keys of fifty rows. Unknown fields are a usage error in
  every mode, listing what there is. **The one behaviour change for scripts:** `--fields` under
  `--json` used to be a no-op; a script that passed it and relied on getting every key back will now
  get only the keys it named. Note the human `id` column shows the identifier (`TES-42`) while the
  JSON `id` key is the UUID, as it always has been.
- **Detail JSON carries relations as objects, not display strings** (TES-627 — a deliberate
  JSON-contract change). `issue view --json` used to flatten every relation:
  `team: "TES Test-workspace-bla"` (not even parseable — team names contain spaces),
  `cycle: "#3 name"`, `assignee`/`project`/`milestone`/`parent` as bare display names with no ids,
  `labels` as names only — while `issue list --json` carried `state: {name,type}` objects, so the
  same field had two types depending on the command. Every one of those keys **stays**, and the
  value under it becomes the object the row already used, plus the id:
  `state: {id,name,type}`, `assignee: {id,displayName,email}`, `team: {id,key,name}`,
  `project: {id,name}`, `milestone: {id,name}`, `cycle: {id,number,name}`,
  `parent: {id,identifier}`, `labels: [{id,name}]`, `subscribers: [{id,displayName}]`. So
  `.state.name` reads the same on a list row and a detail row, and an agent that wants the team
  key, the state type or the assignee id after a `view` no longer needs a second command. Same
  for `project view` (`status: {id,name,type}`, `lead`/`members: {id,displayName,email}`,
  `teams: [{id,key,name}]`, `labels: [{id,name}]`) and `milestone view` (`project: {id,name}`,
  `issues[].state: {id,name,type}`, plus `issues[].id`). The human renderings are unchanged; the
  detail's top-level `id` is still the UUID. **If a script did `jq -r '.state'` or `.team` on a
  view, it now needs `.state.name` / `.team.key`.**
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
- **A resolution failure now points somewhere.** `resolveStateId` already listed the team's states
  when a name did not match, and nothing else did — a miss said only that nothing matched, leaving
  you to guess whether the name was wrong, the scope was wrong, or the thing did not exist. Every
  resolver now ends its not-found message with either the candidates or the command that lists
  them, and neither costs a round-trip: the resolvers that scan (team, workflow state, cycle,
  milestone) already hold the full candidate set, so they list it — capped at 25 names, past which
  they name the discovery command instead of pasting a wall of text. The ones that match through a
  server-side filter (user, project, label) have no candidate set to show and name the command
  instead of fetching one just to write an error.

### Fixed

- **`$EDITOR` with arguments (`code --wait`, `subl -w`, `vim -f`, `emacsclient -t`) broke the
  editor path with a raw ENOENT** (TES-631). `openEditor` ran the whole `$EDITOR` string as the
  executable name. It is now split shell-style — quotes and backslashes honoured, nothing
  expanded — into argv with the file appended, the way git/gh run it; `$VISUAL` is consulted
  before `$EDITOR` (git's precedence; `EDITOR` used to win); a missing editor is a usage error that
  names the program and the variable it came from; and a non-zero editor exit is a failure rather
  than "save whatever is in the file", as in git.
- **`comment update` opened an empty editor, and an empty body wiped the comment** (TES-620).
  The editor now opens on the comment's current body (fetched first, so a bad id fails before
  anyone types), and the update refuses an empty or whitespace-only body ("Refusing to blank the
  comment body. To remove a comment, use 'comment delete'.") and an unchanged one ("nothing to
  update" — quitting the editor untouched is not an edit, and should not stamp `editedAt`).
  Non-interactively, `comment update <id>` with no body is a usage error, not an editor.
- **`issue comment "<body>"` on a matching branch failed** (TES-619) — the README's headline
  example. `issue comment [id] [body]` read a lone operand as the id, so `linear issue comment
  'shipped'` on `tes-615-…` produced "No comment body provided" (and, in a terminal, opened
  `$EDITOR` for the body first and only then rejected `'shipped'` as an id — work lost).
  `assign` and `state` already disambiguated a lone operand; `comment` now does the same: one
  operand that looks like an issue id is the id (body from `--body-file` or the editor), anything
  else is the body with the id inferred from the branch. The id is settled before any editor can
  open. Two operands, the four `add|list|update|delete` subcommands, and `--body-file` are
  unchanged.
- **`-j` did not switch the error boundary to the JSON envelope** (TES-618). The boundary in
  `src/bin/linear.ts` decided the error format by scanning `process.argv` for the literal string
  `--json`, so the `-j` alias, bundled short flags (`-jq`) and every other spelling commander
  accepts printed a plaintext `error: …` on stderr where a script expected
  `{"error":{message,code}}` — an unparseable error stream for exactly the callers the envelope
  exists for. Verified live: `linear issue view NOPE-1 -j` printed `error: No issue NOPE-1.` while
  `--json` printed the envelope. The boundary no longer parses argv by hand: it reads the globals
  back off the command tree commander already parsed (`parsedGlobalOptions` in `src/cli.ts`), which
  finds `-j`/`--json`/`--debug`/`--no-ansi` wherever on the command path they sat, and works for
  parse-time failures too because commander scans the whole argument list before reporting a bad
  option. The contract suite now spawns the real binary against an isolated, key-less config and
  asserts the envelope under `--json`, `-j`, `-jq` and `linear -j issue …`; before, it exercised
  only the `Output` class, which is how this slipped past 600 tests.
- **`linear schema | head` no longer dumps an EPIPE stack** (TES-635 (7)). A reader that stops
  early closes stdout under us; without a listener Bun surfaced the resulting EPIPE as an unhandled
  stream error — a raw `EPIPE: broken pipe, write … fd: 5` on stderr and exit 1. The binary now
  listens for it on stdout and stderr and exits quietly (0), as any Unix filter does. Also fixed in
  passing: `project milestones` printed milestone progress ×100 like the two `milestone`
  renderers (TES-648).
- **An unknown command is reported as one, with a guess; usage errors point at the right
  `--help`; a bare group shows its help** (TES-633). The root has an action (bare `linear` shows the
  branch's issue) and `issue` has a default subcommand (`view`), so commander's own "unknown
  command" never fired for either: `linear issues list` was `too many arguments. Expected 0
  arguments but got 2: issues, list.` and `linear issue lst` was `'lst' is not a valid issue id`.
  Now: `Unknown command 'issues'. Did you mean 'issue'? Run 'linear --help' to see the commands.`
  and `'lst' is not a valid issue id (…). Did you mean 'linear issue list'?` — a prefix (`proj`),
  a small typo (`lable`, `isue`) or an alias (`docs`, `notif`) is close enough; two-letter aliases
  are never guessed from, so `ab` does not "mean" `label`. `.showHelpAfterError()` was configured
  and dead — the stderr it would have written was the one the boundary suppresses — so every
  parse-time usage error now carries the hint itself, in both modes:
  `unknown option '--nope'. Run 'linear issue create --help' for usage.` And a group invoked bare
  (`linear notification`) printed only `error: (outputHelp)`, because commander wrote the group's
  help to that same suppressed stderr; the boundary keeps what commander wrote and prints it (exit
  2), or a one-line usage error under `--json`.
- **Terminal escape sequences in Linear data no longer reach the terminal** (TES-623). API text
  was written to human output byte-for-byte: `renderTable`/`renderDetail`, the bare scalar lines
  (`issue title`), and every status/error line. Anyone who can create an issue in a workspace could
  put colour, cursor movement, a clear-screen, a `\r` overwrite, an OSC-8 fake hyperlink or a
  window-title rewrite into a title, and every teammate's `linear issue list` ran it — verified live
  on a `clitest-esc` issue whose title carried `\e[31m` and an OSC-8 link. Every string that
  reaches a person now passes through one function (`sanitizeForTerminal`, `src/output/sanitize.ts`)
  that strips *whole* sequences — CSI, OSC (BEL- or ST-terminated), DCS/SOS/PM/APC, other `ESC`
  sequences, and their 8-bit C1 spellings — so `\e[31m` vanishes rather than leaving `[31m`
  behind, then whatever C0/C1/DEL and bidi-override characters remain (`\n` and `\t` stay: a
  description is multi-line). It is applied in `cell()` (every table cell and detail value) and in
  `Output.line/info/success/warn/cancelled` and the human error line. **`--json` is untouched**: JSON
  escapes control characters itself and a script is owed the exact bytes; the contract test pins
  both halves. While in `table.ts`: column widths are terminal columns now, not `s.length` — a CJK
  title or one emoji used to push every column after it out of line — via Bun's `stringWidth`, and
  truncation cuts by whole grapheme so an emoji is never split.
- **`milestone view|update|delete` and `state view` take names, not only UUIDs** (TES-634). The
  by-name resolvers existed — `issue create --milestone <name> --project <p>` and `--state <name>`
  use them — but the entity commands sent whatever they were given to `projectMilestone(id:)` /
  `workflowState(id:)`, so a name got the API's "Could not find referenced ProjectMilestone" with
  no hint that only ids were ever tried. `milestone view|update|delete <name> --project <p>` now
  resolves the name inside that project (names are unique per project only, the same rule
  `issue update --milestone` applies); a name without `--project` is a usage error that says so:
  `'…' is not a milestone id; pass --project <name|id> to look a milestone up by name.` `state view
  <name-or-type>` resolves against `--team` or the configured default team, exactly as
  `issue create --state` does, and says to pass `--team` when there is neither. UUIDs still go
  straight through.
- **`milestone list`/`view` printed progress ×100 — `3846%`** (TES-648, found while fixing the
  above). `ProjectMilestone.progress` is already a percentage (`38.46`, verified live), unlike
  `Project.progress`, which is a fraction; the milestone renderers multiplied it by 100 anyway. The
  human output now reads `38%`; the JSON value stays as the API sends it.
- **Detail views are one request each, not six to sixteen** (TES-622). Lists have always used a
  tailored GraphQL query, but every *detail* path awaited the SDK model's lazy relation getters,
  each its own HTTP round-trip. Measured live with a fetch counter before/after:
  `getIssueDetail(TES-601)` **8 → 1**; `getProjectDetail(linear-sdk-cli)` **7 → 1**;
  `getMilestoneDetail` with 13 issues **16 → 1** (it awaited `issue.state` per issue, so `-n 50`
  on a full milestone cost ~53). Each now selects its relations in one query
  (`CliIssueDetail`/`CliProjectDetail`/`CliMilestoneDetail`, in the services), and the unit tests
  record `rawRequest` and assert the call count and the selection, so it cannot regress quietly.
  Two things learned on the way and now written down in the code: Linear prices a query by its
  worst case, so a project lookup at `first: 250` × three nested 50-item connections was refused
  as too complex (49 975 vs. a cap of 10 000) — a name match with a second hit is already
  "ambiguous", so it asks for two; and the milestone's issue pages are followed by cursor with the
  milestone fields riding along, read off the first page. `updateIssue` is unchanged in this pass
  (9 requests): its cost is in the shared resolvers (`resolveLabelIds` fetching each candidate
  label's team, `teamStates` fetching the team then its states, and the SDK payload's lazy
  `issue`), which are a separate change.
- **`issue view`/`issue list` show archived and trashed issues as such** (TES-624). A deleted
  issue read back exactly like a live one — `issue delete TES-616` then `issue view TES-616 --json`
  showed `state: Backlog`, exit 0 — and `--include-archived` mixed live, archived and trashed rows
  indistinguishably. Both shapes now carry `archivedAt`, `trashed`, `startedAt`, `completedAt` and
  `canceledAt` (`trashed` is nullable upstream and is normalised to a boolean). The human `view`
  says so first and in capitals — `Trashed: YES (deleted 2026-08-16T15:41:08.952Z)` /
  `Archived: YES (…)` right under the title — and the list table marks the state column
  `Backlog (trashed)` / `Backlog (archived)`.
- **Rate-limit waits are announced through the Context's `Output`** rather than a bare stderr
  writer, so the "rate limited; retrying in Ns" line honours `--quiet` like every other status line
  and can never land on the JSON stdout a script is parsing.
- **Mutations could report a success the API never gave** (AUDIT.md #6). Every Linear mutation
  answers with a payload carrying `success: Boolean!`, and almost nothing here read it. The
  create/update paths did have a guard, but it tested whether the *entity* came back, not whether
  the write happened — so a `{success: false}` that still carried an entity walked through it — and
  the deletes, archives, subscribes and notification writes discarded the payload unread. Driven
  against a client whose every write is refused, **50 of the 51 mutating service entry points
  resolved happily**; `comment delete` was the single one that checked. The sharpest case was
  `issue update`, which fell back to the issue it had resolved *before* the mutation, so a
  `{success: false, issue: null}` printed `Updated TES-1` and exited **0** — the shell would run the
  `&&` side of a command that changed nothing. All of it now goes through one helper
  (`unwrapMutation` / `assertMutation`, `src/lib/mutation.ts`) that requires `success === true` and,
  where the payload is supposed to carry an entity, that the entity is really there. The payloads
  that genuinely carry nothing but `{success, lastSyncId}` are handled as that, rather than by
  pretending an entity exists.

  A refusal is reported as **`api`, exit 1** rather than the `usage`/exit 2 these paths used to
  throw. Exit 2 tells a script it called the CLI wrong; the caller typed a valid command and the
  server declined it, and the two deserve different codes. `notification read`/`snooze`/`archive`
  now emit a receipt of what the API confirmed instead of restating the request — the command used
  to print `✓ Marked … read` and `{"read": true}` whatever the payload said.

- **`notification read-all` claimed every notification was marked read.** It hardcoded
  `success: true` and reported the number of *unread* notifications it found, not the number it
  actually marked, so a batch where some writes were refused looked identical to one where none
  were. It now derives the aggregate: `count` is how many really went through, `attempted` how many
  it tried, and `failed` lists the ones that did not with the API's reason. A single refusal no
  longer aborts the rest — it is reported instead of hidden, and the human output names each one.

- **`milestone view` reported `issuesTruncated: false` while hiding issues** (AUDIT.md #5). The
  truncation check read `pageInfo.hasNextPage` off the connection *after* collecting from it, and
  `fetchNext()` mutates that connection in place — so the flag described the last page fetched
  rather than the issues the limit hid. With 180 issues at `--limit 150` it returned 150 and said
  nothing was hidden, suppressing the `… more (use --all)` notice at exactly the moment it was
  needed. Truncation is now a fact rather than an inference: one extra item is requested (in the
  same page, so it costs no round-trip) and its presence is the answer. The unit test that shipped
  alongside the bug passed because its mock's `fetchNext()` returned a *fresh object* instead of
  mutating — every faked connection in the suite now comes from one faithful builder
  (`test/unit/_fakes.ts`) that appends in place and returns `this`, as the SDK does.

- **Name resolution stopped at a fixed page, so a large workspace got false `not_found`s.** The
  resolvers that match client-side asked for a fixed `first: 100`/`first: 250` and searched only
  what came back: a team, workflow state, cycle or milestone that existed past the cap could not be
  resolved by name, and — worse, because it is silent — the *ambiguity* check only ever saw a prefix,
  so a duplicate name past the cap was invisible and the CLI picked one arbitrarily. Resolution now
  follows the connection. The page size is 250 (Linear's maximum), so the ordinary workspace still
  costs the single request it always did and only workspaces that really have more than 250 of
  something pay for extra pages. The scan is bounded at 2000 rather than unbounded, and hitting the
  bound is an honest error asking for the id — not a quiet truncation.

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
- **`--no-input` did nothing** (AUDIT.md #3). It is the flag that makes the CLI safe to run
  unattended, and it had never once had an effect. Two independent faults, either of which alone
  was fatal. First, the key: commander stores a negation under the name with `no-` stripped, so the
  parser wrote `input: false` while `Context` read `noInput` — a field nothing ever set, so the
  guard was reading `undefined` forever. Second, and the reason fixing the key would not have been
  enough: a lone negation is *also* seeded with a default of `true` on every command it is
  registered on, including the root program, and `optsWithGlobals()` lets ancestors overwrite
  descendants. Because global options are usable in any position, the flag is parsed by the
  subcommand — so the root's default `true` then overwrote the subcommand's `false` on the way into
  `Context`. Both `--no-input` and `--no-ansi`/`--no-color` are now registered as ordinary boolean
  flags rather than commander negations: the key is ours to choose, and there is no default, so the
  key is absent unless the user passed the flag and nothing can clobber it.
- **`--json` and a non-TTY stdout now imply non-interactive.** A prompt inside a pipeline is not a
  question, it is a hang — there is nobody at the other end to answer it. JSON output is what a
  script or an agent asks for, so asking for it is enough to mean "do not stop and ask me"; the same
  goes for a redirected stdout, which is where inquirer draws the prompt and would therefore write
  the question into the caller's output. Commands that need a missing value now fail with the usual
  usage error naming the flag to pass, instead of waiting forever.
- **`--no-color` broke `label create`** (AUDIT.md #4). The global terminal-colour flag and the
  entity flag `--color <hex>` both reduced to commander's `color` attribute, so
  `label create --name x --team TES --no-color` put `color: false` into the mutation input and
  Linear rejected the call outright: `Variable "$input" got invalid value false at "input.color"`.
  `project` and `roadmap` escaped the crash only because their guards happened to be truthy-based —
  they dropped the flag instead. Beyond the crash, there was simply no way to set an entity colour
  *and* turn off terminal colour in one command, because one flag overwrote the other. The global
  is now spelled **`--no-ansi`**, with `--no-color` kept as an alias on every command (it is the
  conventional spelling, and both write the same key, so they cannot drift). Terminal colour and
  entity colour are separate keys now, which makes the whole class of collision structurally
  impossible rather than fixed one command at a time — a test walks the command tree and asserts no
  option anywhere can write `false` into `color`.
- **`auth login` echoed the API key** (AUDIT.md #9). The prompt used inquirer's `input`, so the
  credential appeared on screen as it was typed and then stayed in the terminal's scrollback for as
  long as the window lived. It now uses inquirer's `password` prompt, which never renders the value.
  `--key` is unchanged for scripts, and nothing in the command logs or echoes the key — the receipt
  names the user and the file it was written to.
- **`--json --debug` produced output that could not be parsed.** The debug detail was appended
  *after* the error envelope as a second, plaintext block, so the one combination a caller reaches
  for when a scripted call misbehaves was the one that broke the contract:
  `linear … --json --debug 2>&1 | jq` died with "Invalid numeric literal". In JSON mode the detail
  now lives inside the envelope as `error.detail`. Without `--debug`, or when the error carries no
  detail, the key is absent and the locked `{message, code}` shape is byte-for-byte what it was.
- **A declined confirmation exited 0 and said nothing.** Every gated command answers a "no" with a
  bare `return`, which produced an empty stdout and a success status — indistinguishable from a
  delete that worked, so `linear issue delete X && …` ran the `&&` side after the user had just
  said no. Declining now emits a cancellation receipt — `{"cancelled": true, "action": "…"}` on
  stdout in JSON mode, a `Cancelled: …` note on stderr otherwise — and exits **6**, a code that is
  neither success nor any of the failures, so a script can tell "you said no" apart from "it broke".
  The receipt is emitted by `confirmDestructive` itself rather than at each of the ~14 call sites,
  which is what makes it identical across every gated command instead of something each one has to
  remember. (The exit code currently lives next to the prompt rather than in the `ExitCode` table
  in `lib/errors.ts`; folding it in is a follow-up.)
- **Integer flags accepted values they then quietly changed.** `Number.parseInt` stops at the first
  character it cannot use, so `--priority 1.9` became `1` and `--estimate 2junk` became `2` — a
  different request from the one that was typed, executed without comment. A flag value must now be
  a complete integer. Priority additionally validates the 0–4 range locally, matching the wording
  `initiative` has used all along, so the two cannot read as different rules.
- **`project update --team` was accepted and ignored** (AUDIT.md #8). It is rejected now, rather
  than implemented: a project belongs to *several* teams, and the existing `--teams` **replaces**
  that whole set — so quietly treating `--team TES` as `--teams TES` would remove every other team
  from the project, which is a destructive reading of a flag the user most likely meant as "also
  this team". The error names `--teams` and says that it replaces. The flag is declared locally on
  the command (which is what stops the global from being injected over it) and hidden, so `--help`
  and `linear commands --json` advertise only the flag that works. `project create --team` is
  untouched — there it is the genuine fallback team.
- **`api --operation` did nothing at all** (AUDIT.md #7). It was passed as a fourth argument to the
  SDK's `rawRequest`, which takes three — so it was discarded, and a multi-operation document went
  to the API with no operation named. The API's answer to that is not "run the first one" but a
  flat `The operation does not exist on the query.`, which made multi-operation documents unusable
  and named the wrong culprit. There is no `operationName` to fix this with: the SDK's request body
  carries only `{query, variables}`. So the selection is done before the request instead — the
  document is parsed with `graphql` and the chosen operation, plus the fragments it uses
  transitively, is printed as a new single-operation document. Unreferenced fragments and the other
  operations are left behind. A document with one operation is still sent **verbatim**, so
  formatting and comments survive and nothing changes for the common case. Choosing nothing from a
  multi-operation document is now a usage error that lists the names, rather than a confusing error
  from the server, and `--operation` naming an operation the document does not define is caught here
  too.
- **`api --paginate` never checked what it was re-running** (AUDIT.md #10). The loop re-executes the
  whole document once per cursor, so a *mutation* whose payload happens to contain a paginatable
  connection would have been executed once per page — creating duplicate entities, silently, in
  proportion to how much data came back. It now refuses anything that is not a query, and refuses it
  **before the first request**, so the check cannot itself cost a side effect. The kind is read from
  the same parse that `--operation` uses, which means it is the *selected* operation that is
  checked, not merely the first one in the file.
- **`schema --json --output <file>` ignored the file.** The JSON branch returned before reaching the
  write, so the introspection result went to stdout and no file was ever created — silently, since
  the redirect the user asked for simply did not happen. Format and destination are independent now:
  `--json -o f` writes introspection JSON to `f`, `-o f` alone writes SDL, and each without `-o`
  goes to stdout. A destination that cannot be written is reported as a CLI error naming the path
  rather than a raw `fs` throw.
- **A malformed config file could print an API key to the terminal.** `smol-toml`'s parse error
  embeds an excerpt of the offending source, and we passed that message through untouched — so a
  config truncated mid-credential (`api_key = "lin_api_…` with no closing quote) printed the key to
  stderr, where it lands in scrollback, CI logs and bug reports. The same channel let a project
  `.linear.toml` — a file that is not ours and may arrive with a checkout — emit raw escape
  sequences through our error output. We now report only the reason and the position (`line 3,
  column 36`), never an excerpt from a credential-bearing file, and strip control characters and
  bidi overrides from what remains. The error stays actionable: it still says exactly where to look.
- **Credential writes could lose a config or leave a truncated one.** Writing the config in place
  truncates it first, so a crash or a concurrently-running `linear` could observe — or leave behind
  — a half-written file, which for this file means every stored credential gone. The write now goes
  to a temp file in the same directory and is renamed over the target, which POSIX makes atomic: a
  reader sees either the old config or the new one. The temp file is created `0600` so the key is
  never briefly world-readable, and the final file is still asserted to `0600` rather than
  inheriting whatever was there.

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
