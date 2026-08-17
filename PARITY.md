# Parity Review — `linear-sdk-cli` vs `schpet/linear-cli` v2.5.0

_Reviewed 2026-08-16 against the **schpet original** at `5af8286` (v2.5.0, Deno/cliffy). Every
claim was verified in that source or against the live API. Earlier versions of this file compared
against a Bun fork at "v2.1.0" that already carried 2.2–2.4 features; treat anything older as
superseded._

The bar this project sets for itself: **better than schpet/linear-cli in every way** — simplicity,
integrity, reliability, security, ergonomics — with an easy switch for its users (`MIGRATING.md`).
This file is the honest scorecard against that bar. Where we are not there yet, it says so and
names the Linear issue.

## Scorecard

| Dimension | Verdict | Evidence |
|---|---|---|
| **Integrity** (does it do what it says) | **Ours ahead** | Every mutation asserts `success` + entity via one helper (`src/lib/mutation.ts`); schpet checks `success` on ~33 of its mutation sites, entity presence on fewer. Every resolver scans past page one and names candidates on a miss. Two silent-wrong-result filters and a `--no-input` that did nothing were found and fixed here this week — by an external audit we ran on ourselves; see `AUDIT.md`. |
| **Agent / scripting contract** | **Ours ahead** | Uniform bare array/object JSON on all 141 commands; `{"error":{message,code}}` on stderr; exit codes 0–6. schpet: `--json` on **19 of 90** command files — `issue create`, `issue update`, `issue mine` have none — and `Deno.exit(1)` for every failure (16 sites, one code). `linear commands --json` + `linear schema` for cold discovery; schpet ships a static skill. |
| **Security** | **Ours ahead on the boundary, behind on storage → TES-645** | Ours: API key never read from a project file; 0600 atomic writes; masked prompt; TOML errors never echo a secret; `api --paginate` refuses mutations. schpet: stores in the **system keyring** (we do not — yet, TES-645, P1) but loads project `.env` files, which can supply a key. |
| **Reliability** | **Even → ours after TES-626/630** | Both retry. Ours had silent full-`Retry-After` sleeps and unwrapped `fetchNext` (TES-626, in progress) and misclassified network errors (TES-630). schpet: several lists issue one connection request only (no pagination). |
| **Simplicity** | **Ours** | ~10k LOC vs ~22k; commands → services → SDK with a single mutation unwrapper, single filter builder, single pagination helper. schpet's codegen + vendored schema is a heavier build. But: 7 duplicate list implementations here (TES-629, in progress). |
| **Ergonomics — human** | **schpet ahead** | Rendered markdown, pager, width-aware tables, `-w/-a` everywhere, richer interactive create, contextual empty states. Ours prints raw markdown into scrollback (TES-599). Honest gap. |
| **Ergonomics — flags** | **Ours** | One meaning per short letter across the tree (`-t`=`--team` always). schpet 2.5: `-a` = `--app`/`--all`/`--assignee`/`--attach`, `-f` ×4, `-y` ×3, `-t` = `--title` and `--team`. Every schpet spelling is accepted here as an alias (§5 of `MIGRATING.md`). |
| **Breadth (data model)** | **Ours** | Notifications, webhooks, favorites, organization, roadmaps, cycle create/update, comment resolve/reply/thread, label hierarchy, `issue archive/unarchive/subscribe`, attachment list/delete, team view/update — none in schpet. |
| **Depth (issue workflows)** | **schpet ahead → closing** | File upload (`issue attach`, `--attach` on comments, private-by-default) — TES-602. `issue commits`, jj, `team autolinks` — deliberately not adopting. Agent sessions, `project delete`, `team delete`, initiative↔project links, relative cycle refs, six document targets — all in flight (TES-644/603/611/613). |
| **Migration** | **In progress → TES-606** | Aliases done; `MIGRATING.md` drafted; Keychain read (TES-645), config-path discovery (TES-638), `config init` (TES-600) and the `linear` bin collision (TES-607) are the remaining pieces. |

## Where schpet is genuinely better (no spin)

1. **Human terminal output.** Markdown rendering, paging, Unicode-width tables. This is what a
   person notices first, and we have not built it.
2. **Keyring credential storage** with plaintext opt-out and `auth migrate`. Ours is a 0600 file.
3. **File attachments** — upload, inline-image hints, `--attach` on comments.
4. **Interactive `issue create`** — guided prompts, template awareness (`--no-use-default-template`).
5. **Config generation** (`linear config` writes the toml) and config discovery in more locations.
6. **Cycle references** — `now`/`next`/`previous`/`+1`, and a cycle column in lists.

Every one of these has an open issue in the `linear-sdk-cli` Linear project.

## Where we are better (verified, not asserted)

1. **JSON is universal and uniform.** schpet's `issue create --json` does not exist; an agent
   creating an issue there gets human text.
2. **Exit codes carry meaning** — 0 ok, 1 api, 2 usage, 3 not-found, 4 auth, 5 rate-limit, 6
   cancelled. schpet: everything is 1.
3. **Silent-failure posture.** `--json` implies non-interactive; a declined confirmation exits 6
   with a receipt; contradictory flags (`--assignee` + `--unassigned`, both date spellings) are
   usage errors, never a coin flip; a mutation whose payload says `success:false` cannot print
   "Updated".
4. **The trust boundary.** The API key is unreachable from anything a repository can commit.
5. **One meaning per short flag**, and every schpet spelling accepted as an alias.
6. **Discovery:** `linear commands --json` gives an agent the whole surface in one call.
7. **Breadth:** the whole notification/webhook/favorite/org/roadmap surface, and full cycle CRUD.
8. **Size:** under half the code for a larger surface.

## Deliberate divergences

Not gaps. Reasoning in `ALIGNMENT.md`.

- `issue list` stays general; `issue mine` is the "yours, unstarted" view. schpet aliases `list`
  to `mine`, and a `list` that hides colleagues' work is the sharpest silent hazard in a switch.
- `--sort priority` groups by state **ascending** (active work first). schpet hardcodes descending,
  which the API answers with Backlog above In Progress.
- No short-flag reassignment: schpet's own assignments conflict, so there is nothing to copy.
- Uniform JSON over schpet's connection envelopes.

## Method — how to keep this file honest

The previous version rotted because it was edited from memory and compared against the wrong
repository. Before touching it: (1) `git -C <schpet clone> log -1` and update the header;
(2) regenerate the command diff (`linear commands --json | jq -r '.[].path'` vs the `Usage:` lines in
schpet's `skills/linear-cli/references/*.md`) and treat it as *leads* — `issue query` is an alias
here and `issue relation add` a positional operand, both false gaps; (3) verify each row in source
or live and cite it; (4) `AUDIT.md` holds `file:line`-cited findings — link, don't restate.
