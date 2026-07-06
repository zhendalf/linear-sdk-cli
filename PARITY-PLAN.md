# Parity & Ergonomics Implementation Plan

Closes the gaps identified in [PARITY.md](PARITY.md) against the reference `linear-cli`, and
tightens ergonomics (cleaner/slimmer code, better human + agent UX). Built on branch
`feature/parity-ergonomics`.

## Chosen scope (2026-06-27)

**High-value subset, executed autonomously** (one codex-reviewed commit per phase):
**Phase 1** (multi-workspace auth) → **Phase 2** (git/PR workflow) → **Phase 3** (status updates)
→ **Phase 7** (slimming & consistency). Deferred for a later pass: Phase 4 (bulk ops),
Phase 5 (output ergonomics), and `issue agent-session` from Phase 6. The remaining small
parity items from Phase 6 (schema dump, `team delete --move-issues`, `team create --private`,
`document --icon/--edit`, file-upload attachments, richer `issue list` filters) are folded into
the slimming pass only if cheap; otherwise deferred.

## Codex plan-review adjustments (applied)

- **Phase 1 flag collision:** global `--workspace <slug>` collides with `label create
  --workspace` (boolean = workspace-level label). Resolution: take `--workspace <slug>` globally
  for credential-profile selection; **rename the label boolean to `--shared`** (breaking, noted in
  CHANGELOG — pre-1.0).
- **Phase 1 trust boundary:** credential-profile resolution reads **only** flag > `LINEAR_WORKSPACE`
  env > user-config `default_workspace`. It must **never** be steered by project `.linear.toml`
  (secrets stay out of project config). `--api-key`/`LINEAR_API_KEY` remain absolute and bypass
  profile selection entirely.
- **Phase 1 config writes:** replace the line-stripping `writeApiKey`/`clearApiKey` with
  **structured TOML read/write** (smol-toml `stringify`). Per-workspace creds live in quoted
  tables `[workspaces."my-org"]` (hyphenated slugs must be quoted). Preserve a legacy top-level
  `api_key` as the implicit default; clearing one workspace must not touch others. `auth status`
  surfaces `apiKeySource` + active credential workspace; `auth list` shows a `legacy` entry when a
  top-level key exists. Unit tests cover quoted slugs, legacy preservation, default switch, and
  single-workspace clear.
- **SDK confirmed (v87):** `createProjectUpdate`/`projectUpdates`/`projectUpdate` +
  `ProjectUpdateHealthType` (`onTrack|atRisk|offTrack`); `createInitiativeUpdate`/… +
  `InitiativeUpdateHealthType`; two-step `fileUpload` then `createAttachment{url:assetUrl}`;
  agent sessions present. Phase 3 uses the SDK directly.
- **Scope cuts:** **drop `team autolinks`** from Phase 2 (GitHub-perms, not SDK parity) and
  **drop `schema`** + inline image download. Phase 2 = `issue describe` + `issue pull-request`/`pr`
  only. Phase 7 stays cleanup-only; no speculative scaffolding.
- **JSON contract:** `ctx.output` remains the only stdout writer; `gh` output, progress, and any
  upload chatter go to stderr or are suppressed under `--json`. Newly curated SDK members
  (`createProjectUpdate`, `projectUpdates`, `createInitiativeUpdate`, `initiativeUpdates`, …) must
  be added to `CURATED` and the coverage snapshot re-generated, or `audit:coverage` will fail.

## Working rules (per the established workflow)

- **One phase = one reviewed commit.** For each phase: build → `bun run verify` (typecheck +
  lint + unit/contract) → **codex review (read-only)** → apply fixes → live-test where feasible →
  commit. Never commit a phase before codex has reviewed it.
- **Orchestration:** each phase's build fans out to a small agent team (parallel agents owning
  disjoint files) or a workflow; the main loop drives codex review + commit and stays in the loop.
- **Docs are part of every phase**, not an afterthought: update `README.md`, `CHANGELOG.md`,
  and `COVERAGE.md` (re-run `bun run audit:coverage --update` when SDK members are newly curated)
  in the same commit as the feature.
- **Conventions are load-bearing.** New code must match existing patterns: `register*()` +
  `action()` wrapper, services in `src/services/*` wrapping `withRetry`, resolvers in
  `lib/resolve.ts`, all output through `ctx.output` (locked JSON envelope: list=bare array,
  single=bare object, mutation=affected object, errors=`{error:{message,code}}` on stderr).
- **Agent experience is a first-class goal:** every command supports `--json`, stable machine
  output, deterministic exit codes, helpful `not_found`/`ambiguous`/`usage` errors, and `--help`
  text that reads well. No hangs in non-TTY (prompts are TTY-gated; `--no-input` fails fast).
- **jj is out of scope** (git only).

## Tooling available

`codex` 0.142.x, `gh` 2.95 (for the PR workflow). Live test workspace `test-workspace-bla`,
team `TES`, `LINEAR_API_KEY` from the original task. Live fixtures use prefix `clitest-`;
`bun run janitor` sweeps leaks. Run live tests per-batch to avoid the personal key's rate limit.

---

## Phase 1 — Multi-workspace auth & config foundation

**Goal:** support multiple stored workspace credentials with a selectable default, matching the
reference's `auth list/default/token` + global `--workspace`, without breaking the existing
single-key flow.

- User config grows a credentials section keyed by workspace slug (e.g. `[workspaces.<slug>]`
  with `api_key`, plus a top-level `default_workspace`). Keep reading the legacy top-level
  `api_key` as an implicit default so existing installs keep working.
- `config.ts`: credential resolution becomes workspace-aware. Key precedence unchanged
  (flag > `LINEAR_API_KEY` env > user config), but user-config lookup now selects by
  `--workspace`/`LINEAR_WORKSPACE`/default. `writeApiKey`/`clearApiKey` become slug-aware.
- Commands: extend the `auth` group — `auth login [--workspace <slug>]` (validates the key, reads
  the workspace slug from `viewer.organization.urlKey` when not given), `auth list`,
  `auth default <slug>`, `auth token`, `auth whoami` (alias of top-level `whoami`),
  `auth status` (show active workspace + source). Add global `--workspace <slug>`.
- Tests: unit tests for multi-workspace resolution + back-compat; contract test that `--json`
  envelopes hold. Docs: README auth/config section, CHANGELOG.

**Risk:** changing `config.ts` touches every command's credential path → keep the change additive
and covered by unit tests; codex review focuses here.

## Phase 2 — Git + GitHub PR workflow

**Goal:** the reference's biggest differentiator — turn an issue into commits/PRs.

- `issue describe [id]` — print the issue title + a trailer (`Fixes ENG-123` / `Refs ENG-123`
  with `-r/--references`) suitable for commit messages.
- `issue pull-request [id]` (alias `pr`) — create a GitHub PR via `gh` with the issue
  title/body; flags `--base --head --draft --title --web`. Fail gracefully if `gh` is missing or
  not a GitHub repo (clear usage error).
- `team autolinks [key]` — configure GitHub repo autolinks for the team prefix (via `gh api`),
  guarded behind confirmation.
- Small VCS helpers added to `git.ts` (remote URL parse, current branch already exists). No jj.
- Tests: unit-test the trailer/branch/remote parsing (pure functions); PR creation is shelled out
  so cover with parsing/arg-building unit tests, not live. Docs: README "Git workflow" section.

## Phase 3 — Status updates

**Goal:** `project-update` and `initiative-update` groups (reference has these; we only list
project updates today).

- `project-update create <project>` (`--body`/`--body-file`/`--editor`, `--health
  {onTrack,atRisk,offTrack}`) and `project-update list <project>`.
- `initiative-update create <initiative>` / `initiative-update list <initiative>` (same shape).
- New services `services/project-update.ts`, `services/initiative-update.ts`; reuse `lib/body.ts`
  and the health enum from the SDK. Fold the existing `project updates` list into / alongside the
  new group for consistency.
- Tests: unit + live create/list against `TES`. Docs + COVERAGE update.

## Phase 4 — Bulk operations (cross-cutting)

**Goal:** reference parity for batch mutations.

- Shared helper `lib/bulk.ts`: resolve ids from `--bulk <ids...>` / `--bulk-file <path>` /
  `--bulk-stdin`, run an action over each with aggregated success/failure reporting and a single
  confirmation. JSON mode emits an array of per-item results.
- Apply to `issue delete`, `issue archive`, `document delete`, `initiative archive/delete`
  (matching the reference), and any other destructive single-id command where it's natural.
- Tests: unit-test the bulk resolver + reporting; live smoke on issues. Docs: README + per-command
  help.

## Phase 5 — Output ergonomics

**Goal:** make `view` output pleasant for humans without breaking `--json` for agents.

- Markdown rendering for issue/project/document/initiative bodies on a TTY (lightweight renderer
  in `output/`; plain text when piped/`--no-color`/`--json`). Add `--raw` to bypass.
- Auto-pager for long human output with `--no-pager` to disable (never pages in `--json`/non-TTY).
- `-w/--web` / `-a/--app` open flags applied consistently across list/view commands (today only
  `issue view --web`).
- Optional inline image download for `view` (`--no-download` to keep remote URLs); keep minimal.
- Tests: renderer unit tests (markdown→text, color gating); ensure JSON/contract tests unaffected.

## Phase 6 — Issue power features + minor parity

**Goal:** sweep the remaining reference-only items.

- Richer `issue list`/query filters: `--all-teams`, `--unassigned`, `--created-after`,
  `--updated-after`, `--search-comments` (verify SDK filter support; extend `addFilterOptions`).
- File-upload attachments: `attachment create --file <path>` (in addition to `--url`), using the
  SDK file-upload flow; keep existing URL attach + `attachment list/delete`.
- `issue agent-session list/view` — **only if** `@linear/sdk` v87 exposes agent sessions; if not,
  document the gap and route via `linear api`. (Build agent verifies SDK support first.)
- Minor: `schema` command (dump GraphQL SDL/introspection), `team delete --move-issues`,
  `team create --private`, `document --icon` / `-e/--edit`.
- Tests + docs + COVERAGE for each newly curated member.

## Phase 7 — Slimming & consistency pass

**Goal:** deliver the "cleaner, slimmer, better UX" mandate as a dedicated quality sweep (no new
features). Quality-only — bugs are caught by codex per phase.

- De-duplicate option/flag declarations and resolver patterns surfaced across phases 1–6; pull
  repeated command scaffolding into shared helpers where it reduces lines without hurting clarity.
- Audit flag naming consistency across groups (date flags, `--web/--app`, `--body-file`/stdin,
  confirmation, JSON), and align help text / examples.
- Agent-experience audit: confirm every command's `--json` shape, exit codes, and error codes are
  consistent and documented; add a short "for agents/scripts" section to the README.
- Final docs sweep: README command table, CHANGELOG, COVERAGE snapshot, and refresh PARITY.md to
  reflect the new state.
- Codex review of the whole diff; then squash-free commit.

---

## Sequencing & dependencies

1 (foundation) → then 2, 3, 4, 5, 6 are largely independent and could be reordered; 7 last.
Recommended order as numbered. Each lands as its own codex-reviewed commit on
`feature/parity-ergonomics`.
