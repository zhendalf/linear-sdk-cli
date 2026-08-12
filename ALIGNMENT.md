# Alignment pass — scope

Goal: someone moving from `linear-cli` (the reference, v2.1.0) should be able to keep their muscle
memory and their scripts, without our implementation absorbing that CLI's design debt.

## Two findings that set the priorities

**1. Their short flags are internally inconsistent, so "align the short flags" has no coherent target.**
Counted across their whole `src/` tree:

| Short flag | Their meanings | Ours |
|---|---|---|
| `-t` | `--title` (7 commands), `--team` (4) | `--team` (all 135) |
| `-s` | `--status` (4), `--state` (4) | `--state` (4) |
| `-f` | `--force` (4), `--description-file` (2), `--content-file` (2), `--from-ref` (1) | `--fields` (all 135) |
| `-a` | `--app` (7), `--assignee` (2), `--all` (2) | `--assignee` (4) |
| `-l` | `--label` (4), `--lead` (2) | `--label` (7) |
| `-p` | `--priority` (2), `--parent` (1) | `--project` (6) |
| `-c` | `--content` (2), `--color` (2) | — |

Adopting `-t = --title` would contradict their own `-t = --team`. We would be importing ambiguity,
not compatibility. Ours is one meaning per letter, everywhere.

**2. Every short-flag collision already fails loudly.** Typing their flags at our CLI, verified live:

```
-t 'Fix login'    → prompts for Title (took it as --team)   [loud]
-p 2              → "No project matching '2'."              [loud]
-n 'My Project'   → "Expected --limit to be a positive integer, got 'My Project'."  [loud]
--limit 0         → "Expected --limit to be a positive integer, got '0'."           [loud]
```

None silently does the wrong thing. **So short-flag reassignment buys better error messages, not
correctness** — which makes it the lowest-value work in this pass, not the highest.

**Therefore: prioritize by failure mode.** Silent divergences are the real scope. Loud ones get
aliases and documentation.

---

## Phase 1 — Silent divergences (the actual risk) · ~½ day

Only three differences make a transplanted command succeed while returning *different data*.

| # | Divergence | Ours | Theirs | Proposal |
|---|---|---|---|---|
| 1.1 | `issue list` result set | team-wide, all states, all assignees | alias of `mine`: **you**, unstarted only | **Add `issue mine`** with their defaults. Keep `list` general — a command named "list" should list. Additive, no behavior change. |
| 1.2 | Repeated `--label` | OR (broadens) | AND (narrows) | **Decision needed.** I lean adopt AND: repeated filters narrowing is the common CLI convention, and it makes transplanted scripts correct. |
| 1.3 | `--sort priority` | priority desc | workflow state desc → priority desc → manual asc | **Decision needed.** I lean adopt theirs, since "priority" ordering that ignores state surprises people coming from the Linear UI. Low harm either way — ordering, not membership. |

## Phase 2 — Free aliases (zero risk) · ~½ day

Purely additive; nothing changes meaning. This is where most of the friction actually lives.

- **Short flags with no collision in ours:** `-j/--json` (their most-used flag, 17 commands),
  `-w/--web`.
- **Long-flag spellings:** `--due-date` → `--due`, `--target-date` → `--target`,
  `--start-date` → `--start`, `--search` → `--query`, `--all-states` (no-op; we omit state by
  default). `--status` → `--state` is already shipped.
- **Accepted values:** `self` as an assignee sentinel alongside `me`/`@me`; `--limit 0` as a
  synonym for `--all`; cycle lookup by *name* (we take number/UUID/`current`, they take name/number/`active`) — accept the union.
- **Command aliases:** `issue query` → `issue list`, `auth whoami` → **our top-level `whoami`**,
  `issue comment {add,list,update,delete}` → our top-level `comment` group.

  _(Corrected during implementation: this doc originally mapped `auth whoami` → `auth status`.
  Their `auth whoami` prints workspace + user name/email/role, which is our `whoami`; their
  `auth status` reports credential-file state, which ours does differently. Aliasing it to
  `auth status` would have made a transplanted command succeed while showing different
  information — the silent-divergence class Phase 1 exists to kill.)_

## Phase 3 — Capability gaps a transplanted script hits · ~2–3 days

These fail loudly (unknown flag) but block real workflows. Ordered by how likely a script is to use them.

- `-U/--unassigned` filter
- repeatable `--team` and `--state` (their queries take multiple; ours take one)
- `--created-after` / `--updated-after`
- `--project-label`, and `--milestone` on non-search queries
- `--search-comments`
- `issue update --team` (a real team move — currently accepted and ignored; also audit finding #8)

## Explicitly NOT adopting

| Their behavior | Why not |
|---|---|
| `issue list` aliased to `mine` | A command named `list` that silently filters to you and hides started work is the single worst transition hazard; we solve it by *adding* `mine` instead. |
| `--limit 0` as the only unlimited | We keep `--all` as primary; `0` becomes an accepted synonym, not the spelling we teach. |
| Their JSON shape (connection envelopes, `mine` has no `--json`) | Our uniform bare array/object is the main advantage for agents. Aligning here would be a downgrade. |
| Short-flag reassignment (`-t`, `-p`, `-n`, `-f`, `-a`, `-l`, `-s`) | Target is self-contradictory (finding 1), and every collision already fails loudly (finding 2). High churn, near-zero correctness gain. |
| Their per-command option model | Our globals have real problems (see AUDIT.md #8), but the fix is auditing which commands honor them, not per-command duplication. |

## Decisions needed before starting

1. **`--label` repeated: AND or OR?** (Phase 1.2) — the only change that alters existing results.
2. **`--sort priority`: adopt their state-first ordering?** (Phase 1.3)
3. **Any short-flag reassignment at all?** My recommendation is none; if you want one, `-j/--json`
   is free and `-n` (ours `--limit` vs theirs `--name`) is the most common genuine collision.

## Effort summary

| Phase | Scope | Effort | Risk |
|---|---|---|---|
| 1 | 3 silent divergences | ~½ day | Changes results — needs the two decisions |
| 2 | ~15 aliases | ~½ day | None (additive) |
| 3 | 6 filter/capability gaps | 2–3 days | None (additive), some SDK filter work |

Phases 2 and 3 are independent of the decisions and can start immediately. A "coming from
linear-cli" table in the README should ship with Phase 2.
