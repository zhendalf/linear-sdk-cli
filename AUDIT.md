# External Audit — `linear-sdk-cli` vs `linear-cli` v2.1.0

_Run 2026-08-12 by Codex (`gpt-5.6-sol`, ultra reasoning, read-only) in three independent passes —
feature parity, ergonomics, implementation — against `zhendalf/linear-cli` at `bfe8176` (v2.1.0).
Every finding below marked **[verified]** was independently reproduced here before being written down;
findings marked **[reported]** come from the audit and are plausible but not yet reproduced.
The three full reports are kept verbatim in `_audit-reports/` as the evidence behind this summary._

## Verdict

- **Ours is the stronger foundation for agents and scripts; theirs is the better terminal tool today.**
  Our uniform JSON envelope, stable error codes, distinct exit statuses, and live discovery
  (`linear commands --json`, `linear schema`) have no equivalent there. Their rendered markdown,
  pager, width-aware tables, contextual empty states, and masked secret input have no equivalent here.
- **Neither is a superset.** We are broader across the Linear data model (notifications, webhooks,
  favorites, organization, cycle mutations, attachment lifecycle, comment resolution, label
  hierarchy). They are deeper in issue discovery, file uploads, portfolio linkage, bulk operations,
  agent sessions, and VCS integration.
- **The agent contract we advertise is not yet dependable.** `--no-input` is dead, some mutations
  report success they never checked, and one list filter silently returns everything.
- **Three of the confirmed defects are in code written on 2026-08-12** (the milestone truncation
  notice, the `--color` collision extended to projects, and stale `PARITY.md` claims). The unit test
  written alongside the truncation code passed *because its mock was unfaithful to the SDK*.

---

## Confirmed defects (reproduced here)

Ranked by severity. Each has a reproduction, not just a code reading.

### 1. `project list --state` is completely inert — returns every project **[verified]**
`buildFilter` sets `filter.state = { eq: value }` ([project.ts:61](src/services/project.ts:61)), but
`ProjectFilter.state` is the deprecated legacy field and the API **silently ignores it**. Verified
against the live API — every value returns all projects, including nonsense:

```bash
linear project list --state completed --json | jq length   # 2 (all of them)
linear project list --state nonsense  --json | jq length   # 2 (all of them)
```

A raw query confirms the API, not our code, does the ignoring; the correct filter works:
`filter: {status: {name: {eqIgnoreCase: "backlog"}}}` returns 2, `"nonsense"` returns 0.
Worse than a wrong result — a script filtering for completed projects silently processes all of them.
**Fix:** filter on `status.name.eqIgnoreCase`. (`project list --team` was checked and works correctly.)

### 2. `issue list --label` is case-sensitive and silently returns nothing **[verified]**
`filter.labels = { some: { name: { in: f.label } } }` ([issue.ts:~137](src/services/issue.ts:137)) uses
an exact-case comparator, while `resolveLabelIds` elsewhere matches case-insensitively.

```bash
linear issue list --team TES --label Bug --json | jq length   # 1
linear issue list --team TES --label bug --json | jq length   # 0
```
No error, no hint — just an empty list. **Fix:** case-insensitive comparison.

### 3. `--no-input` does nothing **[verified]**
Commander stores `--no-input` as `opts.input = false`; [context.ts:41](src/context.ts:41) reads
`options.noInput`, which is always `undefined`, so `isTTY` stays true and prompts still fire.
Proven with a commander probe: `p.parse(["--no-input"])` → `{"input":false}`.
The same interface even documents the convention for color (`// commander sets false for --no-color`).
**Fix:** read `input === false`; also treat `--json`/non-TTY stdout as non-interactive.

**FIXED.** The audit found the first half; reproducing it turned up a second, independent fault that
would have kept the flag dead even after reading `input === false`. A lone negation is *also* seeded
with a default of `true` on every command it is registered on — including the root program — and
`optsWithGlobals()` lets **ancestors overwrite descendants**. Because `enablePositionalOptions()`
lets globals be used in any position, the flag is parsed by the *sub*command, so the root's default
`true` overwrote the subcommand's `false` on the way into `Context`. Verified on a faithful
commander repro: `linear delete --no-input --no-color` gives local `{input:false,color:false}` and
merged `{input:true,color:true}`. Both `--no-input` and the colour flag are now registered as plain
boolean options (`NoFlagOption`, [options.ts](src/lib/options.ts)) rather than commander negations:
we choose the key, and there is no default, so the key is absent unless the flag was passed and
nothing can clobber it. `Context.isTTY` additionally requires a TTY on **both** stdin and stdout and
is false under `--json` — inquirer draws on stdout, so a redirect would put the question in the
caller's output, and JSON is what a script asks for. Tested against commander's parsed keys via
`createProgram()`, not against `GlobalOptions` — the interface is what lied, so a test of the
interface could never have caught this. Not exercised end to end: this session has no TTY, so the
"a prompt would have fired" half is asserted through the parsed key and the resulting `isTTY`.

### 4. `--no-color` breaks `label create` **[verified]**
Global `--no-color` and the entity `--color <hex>` share one commander key. `label create` guards with
`!== undefined` ([label.ts:91](src/services/label.ts:91)), so `false` reaches the API:

```bash
linear label create --name x --team TES --no-color
# error: Variable "$input" got invalid value false at "input.color"
```
`project create/update --color` (added 2026-08-12) escapes only because its guard is truthy-based.
There is also no way to set an entity colour *and* disable terminal colour. **Fix:** rename the global
to `--no-ansi`, or read it from a distinct key.

**FIXED**, both suggestions at once. The global is spelled `--no-ansi`, and `--no-color` survives as
an alias on every command — including the ones that own a `--color <hex>`, which is the whole point —
because both are registered as plain booleans storing the single key `noAnsi` (`NoFlagOption`,
[options.ts](src/lib/options.ts)). Terminal colour and entity colour are now different keys, so the
collision is structurally impossible rather than fixed per command: `roadmap create/update --color`,
which had the same latent defect and was not named in the audit, is correct without being touched.
Verified live against `test-workspace-bla`: `label create --name x --team TES --no-color` succeeds,
and `label create --color '#EB5757' --no-color` sets the entity colour *and* disables terminal
colour in one invocation (as does `--no-ansi`); same for `project create`. A tree-walking test
asserts that no option anywhere can write `false` into `color`, so a future `--color <hex>` on a new
command is covered without a new test.

### 5. `milestone view` reports `issuesTruncated: false` while hiding issues **[verified]**
`collect()` mutates the connection in place, so the post-collection check at
[milestone.ts:~104](src/services/milestone.ts:104) sees the *final* page's `hasNextPage: false`.
Reproduced with faithful SDK semantics (180 issues, `--limit 150`):
returns 150, reports `issuesTruncated: false`, hides 30. The `… more (use --all)` notice is suppressed
exactly when it is needed. The unit test passed because its mock's `fetchNext` returned a **new**
object instead of mutating, so the multi-page path was never exercised.
**Fix:** request `limit + 1` and derive truncation from the extra item; fix the mock.

**FIXED**, both halves. Reproduced first with a mock faithful to the SDK — `fetchNext()` appends to
`this.nodes`, mutates `this.pageInfo` and returns `this` (`node_modules/@linear/sdk` `Connection`) —
which gave exactly the audit's numbers: 180 issues at `--limit 150` returned 150 and reported
`issuesTruncated: false`. Truncation is now a fact rather than an inference read off a connection
that collection has already moved past: `collectWithMore` ([pagination.ts](src/lib/pagination.ts))
asks for one item beyond the limit and the presence of that item *is* the answer. The spare slot is
requested in the same page (`pageSizeForMore`), so detecting truncation costs no extra round-trip
for a limit that fits in one page. Verified live on `test-workspace-bla` (3 issues, `-n 2` → 2 and
`issuesTruncated: true` with the `… more (use --all)` notice; `-n 3` → false; `--all` → false); the
*multi-page* half is proven at unit level rather than live, because reproducing it against the API
means creating 150+ issues in one milestone.

The mock was the more important half. The infidelity was not confined to `milestone.test.ts` —
**twenty test files faked a connection**, some as a bare `{ nodes }` with no `pageInfo` at all, and
every local `conn()` helper returned a fresh object from `fetchNext()`. They now all build on one
faithful builder ([test/unit/_fakes.ts](test/unit/_fakes.ts)), so a service that reads a connection
after collecting from it meets the SDK's semantics instead of a convenient fiction. The same file
supplies faithful mutation *payloads*, which is what finding #6 turned out to need. A test asserting
the connection's own `hasNextPage` is `false` while `hasMore` is `true` is now in the suite, so the
wrong fix cannot look right later.

### 6. Mutations can report success they never checked **[verified]**
`setRead` returns `{id, success}` ([notification.ts:94](src/services/notification.ts:94)) and the command
discards `success`, emitting `{id, read:true}` and `✓ Marked … read` unconditionally
([notification.ts:44](src/commands/notification.ts:44)). `markAllRead` hardcodes `success: true`
regardless of the per-item results. `updateIssue` falls back to the *pre-mutation* issue when the
payload has no issue ([issue.ts:~430](src/services/issue.ts:430)), so a `{success:false, issue:null}`
payload prints `Updated TES-1` and exits 0. **Fix:** one `unwrapMutation` helper asserting
`success === true` and entity presence.

**FIXED**, as the class of bug it is rather than the three named instances. All 19 files in
`src/services/` were swept; the three the audit names were the visible tip. Driving every one of the
**51 mutating entry points** against a client whose every write answers `{success:false}` while
still carrying an entity, **50 of them resolved happily** — `comment delete` was the only place in
the codebase that read `success`. The create/update paths *looked* guarded, but the guard tested
whether the entity came back, not whether the write happened, so a refusal carrying an entity walked
straight through; the deletes, archives, subscribes and notification writes discarded the payload
unread. `updateIssue` was the worst of them, returning the pre-mutation issue exactly as reported.

Everything now goes through `unwrapMutation` / `assertMutation`
([mutation.ts](src/lib/mutation.ts)). The split matters: some Linear payloads genuinely carry
nothing but `{success, lastSyncId}` (deletes, archives, `updateNotification`), and those use
`assertMutation` and return a receipt of what was confirmed, rather than being handed a fake entity.
One deliberate change beyond the finding: a refusal is now **`api`, exit 1**, where these paths threw
`usage`, exit 2. Exit 2 tells a script it called the CLI wrong; here the caller typed a valid command
and the server declined it. `markAllRead` no longer hardcodes an aggregate — it reports `count`
(what really went through), `attempted`, and a `failed` list carrying the API's reason per item, and
one refusal does not abort the rest.

The proof is unit-level and stated as such: a real `{success:false}` from Linear cannot be provoked
on demand, so there is no live coverage of the failure path — only of the happy paths, re-verified
live on `test-workspace-bla` (issue create/update/state/subscribe/unsubscribe, label
create/update/delete, comment add/delete, milestone create/update, `notification read-all`). The
sweep ([test/unit/mutation-sweep.test.ts](test/unit/mutation-sweep.test.ts)) covers the refusal path
for every entry point in both shapes — with and without an entity in the payload — and all 104 of
its assertions fail against the code as it was.

### 7. `api --operation` is inert **[verified]**
We pass a 4th argument to `rawRequest`, which takes three
([SDK index.d.mts:121](node_modules/@linear/sdk/dist/index.d.mts:121)); it is discarded, so
multi-operation documents silently run the first operation.
Related: **`schema --json -o file`** returns before the write branch
([discover.ts:~80](src/commands/discover.ts:80)) — prints to stdout, writes no file.

**FIXED.** Both. One correction to the finding: a multi-operation document did not run the first
operation — the API rejected the whole request with `The operation does not exist on the query.`,
because `rawRequest`'s body carries only `{query, variables}` and no operation was named. Verified
live before the fix, including that `--operation Nope` on a single-operation document exited 0,
proving the flag was discarded rather than validated. Since the SDK offers no `operationName`, the
selection now happens before the request: `prepareDocument`
([api.ts:164](src/commands/api.ts:164)) parses the document with `graphql` and prints a new one
containing the chosen operation plus its transitively-referenced fragments. A single-operation
document is sent verbatim. `--operation Second` and `--operation First` on the same two-operation
file now return different data, verified live. `schema` output is now format × destination
([discover.ts:76](src/commands/discover.ts:76)): `--json -o f` writes introspection JSON,
`-o f` writes SDL, each without `-o` goes to stdout.

### 8. `issue update --team` / `project update --team` are accepted and ignored **[verified]**
The global `-t/--team` is registered on every command but never read by these actions. Alone it
produces a misleading `Nothing to update; pass at least one field`; combined with another flag it is
silently dropped. Theirs performs a real team move. This is the sharpest instance of a general
problem: **all twelve globals are advertised on every command**, including ones that cannot honor them.

**`issue update --team` is FIXED** (alignment Phase 3): it sends `IssueUpdateInput.teamId` and
performs a real move, resolving `--state`/`--cycle`/`--add-label` in the same command against the
*destination* team — verified live, including that the source team's state id is rejected outright
("Discrepancy between issue team and state, cycle or project"). It is declared as a local option on
`issue update` so `--help` says what it does there, and human output announces the new identifier
plus what Linear drops on a move (cycle, team-scoped labels, out-of-team project).

**`project update --team` is now FIXED too — by rejecting it, not by implementing it.** The two
halves of this finding do not have the same answer. An issue belongs to exactly one team, so
`--team` there has an obvious meaning and a real move behind it. A project belongs to *several*
teams, and the existing `--teams` **replaces** that whole set — so quietly reading `--team TES` as
`--teams TES` would delete every other team from the project, a destructive interpretation of a flag
a user most likely meant as "also this team". It is a usage error now
([project.ts](src/commands/project.ts)), naming `--teams` and saying that it replaces; verified live
that it errors with exit 2 both alone and alongside `--name`, and that `--teams` still works. Like
`issue update`, it is declared locally so the global is not injected over it — but hidden, so
`--help` and `linear commands --json` advertise only the flag that works, which is the honest
description for an agent reading the command list. `project create --team` is untouched: there it is
the genuine fallback team.

The underlying problem — every global advertised on every command — still stands as a policy
question; the injection mechanism merely skips a global a command declares for itself, which is what
makes a per-command meaning (or refusal) like this one possible.

### 9. `auth login` prompts for the API key in plain text **[verified]**
[meta.ts:63](src/commands/meta.ts:63) → `promptInput` → `inquirerInput`, so the key echoes to the
terminal and lands in scrollback. Theirs uses a masked prompt. **Fix:** inquirer `password`.

**FIXED.** A new `promptSecret` ([prompt.ts](src/lib/prompt.ts)) wraps inquirer's `password` with
`mask: true`, and `auth login` uses it; `promptInput` is no longer reachable from `meta.ts` at all.
`--key` is unchanged, and nothing in the command logs or echoes the value — the receipt names the
user and the path written. Tested against the library rather than the wrapper (which prompt function
actually ran), since "masked" is a property of inquirer's `password`, not of our function's name.

### 10. `api --paginate` does not check the operation kind **[reported]**
The paginate loop re-runs the whole document per cursor
([api.ts:123-149](src/commands/api.ts:123)) with no query/mutation check, so a mutation whose payload
contains a paginatable connection would be re-executed once per page, creating duplicates. Codex rates
this critical; the preconditions are narrow (the user must pass `--paginate` on such a mutation), but
the guard is one `graphql` parse and the downside is duplicate entity creation. Not reproduced here —
doing so would create real entities.

**FIXED.** Still not reproduced live, deliberately: the reproduction *is* the damage. The guard is
proven instead by the parse and by unit tests that assert `rawRequest` is never called at all for a
mutation, a subscription, or a mixed document whose *selected* operation is a mutation
([api.ts:74](src/commands/api.ts:74)). The kind comes from the same parse `--operation` uses, so the
check follows the operation that would actually run rather than the first one in the file. A real
query still paginates across pages, verified live and in tests.

### Also reported, not yet reproduced
Fixed resolver page caps (`first: 100/250`) can cause false `not_found` on large workspaces;
malformed TOML error text can echo a secret-bearing line to stderr; credential writes are
non-atomic; `issue start` mutates Linear before checkout, so a checkout failure leaves remote state
changed.

Several of this list have since been reproduced and **FIXED**:

- **Fixed resolver page caps** — reproduced exactly as reported. With 300 teams, `resolveTeam` for
  the team at index 260 returned `not_found`; likewise a workflow state past `first: 100`, a cycle
  name past `first: 250`, a milestone past `first: 100`. The audit understated it in one way: the
  silent half is worse than the loud one. A false `not_found` at least stops you, but the
  *ambiguity* check also only ever saw a prefix, so a duplicate name past the cap was invisible and
  the CLI picked one arbitrarily and carried on. Resolution now follows the connection
  ([resolve.ts](src/lib/resolve.ts)). **On the request cost:** the page size is 250, Linear's
  maximum and what two of these resolvers already asked for, so the ordinary workspace still costs
  the single request it always did — only workspaces that genuinely hold more than 250 of something
  pay for extra pages, and then proportionally. The scan is **bounded at 2000** (8 requests) rather
  than unbounded: past that, guessing at a name is the wrong tool, and hitting the bound is an
  honest usage error asking for the id instead of a quiet truncation. The label/user/project
  resolvers match through a server-side exact filter, so they were never really capped, but they
  scan too now — `resolveLabelIds` narrows its results by team afterwards, which could discard a
  whole page and turn a label that exists into a not-found.
- **Resolution failures now point somewhere** (the ergonomics pass). `resolveStateId` listed the
  team's states on a miss and nothing else did. Every resolver now ends a not-found with either the
  candidates or the command that lists them, at no extra round-trip: the scanning resolvers already
  hold the candidate set, so they list it (capped at 25 names, past which they name the discovery
  command rather than paste a wall of text); the server-filtered ones have nothing in hand and name
  the command instead of fetching a list purely to write an error. Verified live: `state list --team
  NOPE` → "No team matching 'NOPE'. Available: TES."; `--assignee nobodyhere` → "No user matching
  'nobodyhere'. Run 'linear user list' to see workspace members."

- **Permissive `parseInt`** — confirmed exactly as reported (`parseIntOption("1.9")` → `1`,
  `"2junk"` → `2`). A flag value must now be a complete integer token, so the CLI can no longer
  execute a quietly different request from the one that was typed. Priority also validates 0–4
  locally, in the same words `resolvePriority` in [initiative.ts](src/services/initiative.ts) has
  used all along — the audit was right that the API returns a clean round-trip error for the range,
  and right that the local/round-trip inconsistency was the actual defect. The `--priority` *filter*
  is validated at the CLI boundary and handed on as the canonical string the issue filter already
  consumes, so the check lands without reshaping the service interface. `issue`/`project`
  create/update `--priority` get the complete-token rule through the shared parser; attaching the
  0–4 range parser at those call sites is a one-line follow-up in files outside this change set.
- **`--json --debug` appends plaintext after the error object** — reproduced live:
  `label create … --no-color --json --debug 2>&1 | jq` failed with "Invalid numeric literal",
  because the detail block followed the envelope as raw text. The detail now lives *inside* the
  envelope as `error.detail`, present only under `--debug` and only when the error carries one;
  without it the locked `{message, code}` shape is unchanged. The contract suite asserts the whole
  stderr stream parses as exactly one JSON value, not merely that its first object does.
- **A declined confirmation exits 0 with no JSON** — declining now emits a cancellation receipt
  (`{"cancelled": true, "action": "…"}` on stdout in JSON mode, a `Cancelled: …` note on stderr
  otherwise) and exits **6**, distinct from success and from every failure code. The audit's
  suggestion was "emit a cancellation receipt"; the exit code is the other half, and the more
  important one — `linear issue delete X && …` ran the `&&` side after a "no". It is emitted inside
  `confirmDestructive` rather than at the ~14 call sites, which is what makes it identical across
  every gated command. Note that with `--json` now implying non-interactive (#3), this path is
  reachable only from a human TTY; the JSON shape is defined and tested regardless. The exit code
  currently lives beside the prompt rather than in the `ExitCode` table in
  [errors.ts](src/lib/errors.ts) — folding it in is a follow-up.
- **Malformed TOML error text can echo a secret-bearing line to stderr** — reproduced with a
  throwaway config (`XDG_CONFIG_HOME`/`HOME` overridden, never the real one): a file truncated
  mid-credential printed `api_key = "lin_api_SUPERSECRETVALUE` verbatim in the error, because
  `smol-toml`'s message embeds a code block of the offending lines and we interpolated it whole. The
  same channel carried raw ANSI from a project `.linear.toml` — `^[[31m` and `^[[2J` (clear screen)
  reached the terminal, from a file that arrives with a checkout rather than from the user. Errors
  now carry only the reason and the position — `Invalid TOML document: control characters are not
  allowed in strings (line 3, column 36)` — with control characters and bidi overrides stripped
  ([config.ts:139](src/config.ts:139)). Actionability is unchanged: the line and column still point
  at the problem, without quoting a file that holds credentials.
- **Credential writes are non-atomic** — confirmed by reading, not by racing: `writeUserObject`
  truncated the config and rewrote it in place, so any interruption or concurrent reader could see,
  or leave, a config missing every credential. It now writes a temp file in the same directory,
  fsyncs it, and renames it over the target ([config.ts:298](src/config.ts:298)). Two of the new
  tests fail against the old implementation — a reader holding the file open across a write still
  sees a complete config, and the path gets a new inode rather than a rewritten one. A *timing*
  reproduction was attempted and abandoned: on APFS with Bun the truncate-to-write window never
  produced a torn read across thousands of samples, so a read-during-write test would have passed
  against the broken code too. Note the rename fixes torn and truncated files; two processes doing
  read-modify-write concurrently can still have one overwrite the other's addition, which would need
  locking to close.

---

## Parity

**Real gaps in ours** (ranked by the audit): issue team reassignment and exact label replacement;
richer query facets (unassigned, multi-team/state, project-label, milestone, date bounds, comment
search); file uploads for attachments and comments; initiative↔project linking; project slug
resolution and all-teams listing; health-only status updates; richer `issue view` (children,
attachments, documents, threaded comments); agent sessions; project delete and initiative unarchive.

**Real gaps in theirs:** notifications, webhooks, favorites, organization metadata/invites, cycle
create/update, project archive and broad project update, comment resolve/unresolve, issue
subscribe/unsubscribe, attachment list/delete, team view/update, label update and hierarchy, user
view/me, workflow-state view, resolved-config readback, command discovery, shell completion, and a
uniform JSON contract. The audit also found **defects in theirs**: initiative update sends invalid
lowercase status enums, search-plus-milestone silently drops the milestone, and several of its lists
issue only one connection request (no pagination).

**Migration hazards** — same flag, different meaning across the two CLIs: `-t`, `-p`, `-a`, `-n`,
`-f`, `-l`, `--team`, `--all`, `--workspace`, repeated `--label`, and `--sort priority`.

## `PARITY.md` is stale

The audit found ~25 wrong or overstated claims, including several the 2026-08-12 refresh missed:
- **`schema` is listed as reference-only in three places** — we ship `linear schema`.
- SDK version still says v87 (now `^89.0.0`).
- "Full cycle CRUD" — we have no cycle archive/delete.
- "user list" and comment `reply` are listed as ours-only; theirs has both.
- "Config file: user-config only" — we *do* read project `.linear.toml` for non-secret settings;
  only credential resolution excludes it.

## Where the audit overstated

Kept here so the report is not read as uniformly authoritative:
- It claimed priority ranges "are not enforced". The parser is permissive, but the API returns a clean
  `priority must not be greater than 4`. That is a local-vs-round-trip inconsistency (and inconsistent
  with initiative/project priority, which validates locally), not a correctness hole.
- It predicted `project list --state "In QA"` would return *nothing*; it actually returns *everything*.
  The real failure mode is the more dangerous of the two.

## Suggested order of work

1. Fix the two silent-wrong-results filters (#1, #2) — smallest diffs, worst consequences.
2. Fix `--no-input` (#3) and the `--color` collision (#4).
3. ~~Add `unwrapMutation` and apply it across services (#6).~~ **Done.**
4. ~~Fix milestone truncation and the unfaithful mock (#5).~~ **Done.**
5. Guard `api --paginate` to queries; implement or remove `--operation`; fix `schema -o` (#7, #10).
6. Decide the global-options policy (#8) — the blanket injection is the root cause of a whole class.
7. Mask the API-key prompt (#9).
8. Rewrite `PARITY.md` against source rather than against memory.
