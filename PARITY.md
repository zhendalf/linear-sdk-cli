# Parity Review — `linear-sdk-cli` vs `schpet/linear-cli` v2.5.0

_Reviewed 2026-08-16, scorecard updated 2026-08-17 after the fix waves, against the **schpet original** at `5af8286` (v2.5.0, Deno/cliffy). Every
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
| **Security** | **Ours ahead** | API key never read from a project file (schpet loads project `.env`, which can supply one); stored in the **OS keyring** by default (macOS Keychain / `secret-tool`, service `linear-cli` — schpet's exact convention, so a schpet credential is found without re-login), `--plaintext` opt-out to a 0600 atomic file; masked prompt; TOML errors never echo a secret; upload URLs (bearer credentials) redacted from every error; `api --paginate` refuses mutations; uploads private by default, `--public` refused for non-images. |
| **Reliability** | **Ours** | Both retry. Ours announces rate-limit waits on stderr with a capped backoff, wraps `fetchNext` so a page-2 429 retries, classifies connection failures as `network` (not `api`), and asserts `success` on every mutation. schpet: several lists issue one connection request only (no pagination). |
| **Simplicity** | **Ours** | ~11k LOC vs ~22k; commands → services → SDK with one mutation unwrapper, one filter builder, one pagination helper, one comment lister (the seven duplicate list pairs are gone). Detail views are one tailored query each (was 6–10 requests). schpet's codegen + vendored schema is a heavier build. |
| **Ergonomics — human** | **schpet ahead** | Rendered markdown, pager, width-aware tables, `-w/-a` everywhere, richer interactive create, contextual empty states. Ours prints raw markdown into scrollback (TES-599). Honest gap. |
| **Ergonomics — flags** | **Ours** | One meaning per short letter across the tree (`-t`=`--team` always). schpet 2.5: `-a` = `--app`/`--all`/`--assignee`/`--attach`, `-f` ×4, `-y` ×3, `-t` = `--title` and `--team`. Every schpet spelling is accepted here as an alias (§5 of `MIGRATING.md`). |
| **Breadth (data model)** | **Ours** | Notifications, webhooks, favorites, organization, roadmaps, cycle create/update, comment resolve/reply/thread, label hierarchy, `issue archive/unarchive/subscribe`, attachment list/delete, team view/update — none in schpet. |
| **Depth (issue workflows)** | **Parity → closing** | File upload landed (TES-602): `issue attach <issue> <file...>` (multi-file, `--title`, `--comment`, `--public`) and `--attach` on `comment add`, private by default with schpet's exact posture — `--public` warns, and is refused for non-images before any byte moves — plus what schpet does not have: a whole batch validated up front, the signed URL redacted from every error, `--json` on both. `issue commits`, jj, `team autolinks` — deliberately not adopting. Agent sessions, `project delete`, `team delete`, initiative↔project links, relative cycle refs — all in flight (TES-644/603/611); six document targets + `update` re-point landed (TES-613). |
| **Migration** | **Done → `MIGRATING.md`** | Verified end-to-end on this machine: schpet's Keychain entry appears in `auth list` with no login; its `linear.toml`/`.config/linear.toml`/global file are read (`config` names the source); every schpet spelling is an alias; `issue attach/link/commits` typed out of habit point at the equivalent; the `linear` bin collision has a documented `lin` escape. Every claim in the guide re-verified against the built binary. |

## Where schpet is genuinely better (no spin)

1. **Human terminal output.** Markdown rendering, paging. This is what a person notices first,
   and we have not built it (TES-599). Unicode-width tables and escape-sanitized output are done.
2. **Interactive `issue create`** — guided, prompt-driven creation. Template handling (`--template`,
   team default unless `--no-default-template`, `--parent` inheriting the project, `--start`) is at
   parity; the wizard is not.
3. **`issue commits`, jj, `team autolinks`** — deliberately not adopted (see divergences).

Struck since the first review, all verified live: keyring storage + `auth migrate`; file attachments
(`issue attach`, `comment add --attach`, private by default); config generation (`config init/set`)
and discovery in every schpet location; cycle references (`now/next/previous/+1`, `active`).

The two remaining gaps have open issues in the `linear-sdk-cli` Linear project.

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
