# External Audit — `linear-sdk-cli` vs `linear-cli` v2.1.0

_Run 2026-08-12 by Codex (`gpt-5.6-sol`, ultra reasoning, read-only) in three independent passes —
feature parity, ergonomics, implementation — against `zhendalf/linear-cli` at `bfe8176` (v2.1.0).
Every finding below marked **[verified]** was independently reproduced here before being written down;
findings marked **[reported]** come from the audit and are plausible but not yet reproduced.
Full raw reports: see `_audit-reports/` (untracked scratch) or re-run per `AUDIT.md` history._

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

### 5. `milestone view` reports `issuesTruncated: false` while hiding issues **[verified]**
`collect()` mutates the connection in place, so the post-collection check at
[milestone.ts:~104](src/services/milestone.ts:104) sees the *final* page's `hasNextPage: false`.
Reproduced with faithful SDK semantics (180 issues, `--limit 150`):
returns 150, reports `issuesTruncated: false`, hides 30. The `… more (use --all)` notice is suppressed
exactly when it is needed. The unit test passed because its mock's `fetchNext` returned a **new**
object instead of mutating, so the multi-page path was never exercised.
**Fix:** request `limit + 1` and derive truncation from the extra item; fix the mock.

### 6. Mutations can report success they never checked **[verified]**
`setRead` returns `{id, success}` ([notification.ts:94](src/services/notification.ts:94)) and the command
discards `success`, emitting `{id, read:true}` and `✓ Marked … read` unconditionally
([notification.ts:44](src/commands/notification.ts:44)). `markAllRead` hardcodes `success: true`
regardless of the per-item results. `updateIssue` falls back to the *pre-mutation* issue when the
payload has no issue ([issue.ts:~430](src/services/issue.ts:430)), so a `{success:false, issue:null}`
payload prints `Updated TES-1` and exits 0. **Fix:** one `unwrapMutation` helper asserting
`success === true` and entity presence.

### 7. `api --operation` is inert **[verified]**
We pass a 4th argument to `rawRequest`, which takes three
([SDK index.d.mts:121](node_modules/@linear/sdk/dist/index.d.mts:121)); it is discarded, so
multi-operation documents silently run the first operation.
Related: **`schema --json -o file`** returns before the write branch
([discover.ts:~80](src/commands/discover.ts:80)) — prints to stdout, writes no file.

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
plus what Linear drops on a move (cycle, team-scoped labels, out-of-team project). **`project update
--team` is still inert**, and the underlying problem — every global advertised on every command —
stands: the injection mechanism now merely skips a global a command declares for itself, which is
what makes a per-command meaning like this one possible.

### 9. `auth login` prompts for the API key in plain text **[verified]**
[meta.ts:63](src/commands/meta.ts:63) → `promptInput` → `inquirerInput`, so the key echoes to the
terminal and lands in scrollback. Theirs uses a masked prompt. **Fix:** inquirer `password`.

### 10. `api --paginate` does not check the operation kind **[reported]**
The paginate loop re-runs the whole document per cursor
([api.ts:123-149](src/commands/api.ts:123)) with no query/mutation check, so a mutation whose payload
contains a paginatable connection would be re-executed once per page, creating duplicates. Codex rates
this critical; the preconditions are narrow (the user must pass `--paginate` on such a mutation), but
the guard is one `graphql` parse and the downside is duplicate entity creation. Not reproduced here —
doing so would create real entities.

### Also reported, not yet reproduced
Permissive `parseInt` accepts `1.9` → `1` and `2junk` → `2` for priority/estimate/cycle; fixed
resolver page caps (`first: 100/250`) can cause false `not_found` on large workspaces; malformed TOML
error text can echo a secret-bearing line to stderr; credential writes are non-atomic; `--json --debug`
appends plaintext after the error object; a declined confirmation exits 0 with no JSON;
`issue start` mutates Linear before checkout, so a checkout failure leaves remote state changed.

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
3. Add `unwrapMutation` and apply it across services (#6).
4. Fix milestone truncation and the unfaithful mock (#5).
5. Guard `api --paginate` to queries; implement or remove `--operation`; fix `schema -o` (#7, #10).
6. Decide the global-options policy (#8) — the blanket injection is the root cause of a whole class.
7. Mask the API-key prompt (#9).
8. Rewrite `PARITY.md` against source rather than against memory.
