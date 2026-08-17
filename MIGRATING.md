# Migrating from `schpet/linear-cli`

_Verified against **schpet/linear-cli v2.5.0** (`5af8286`, 2026-08-11) — the Deno original, not a
fork. If you are on the `@zhendalf/linear-cli` Bun port, everything here applies too; that fork
tracks the original._

The short version: **install, run `linear auth status`, keep typing what you typed.** Your
credentials are found where schpet left them, your `.linear.toml` is read from the same places, and
schpet's spellings are accepted as aliases. Where the two CLIs genuinely differ, the difference is
loud — a usage error, never a quietly different result.

## 1. Install (and the `linear` name)

Both CLIs install a binary called `linear`. If schpet's is on your `PATH`, ours will shadow it — or
be shadowed — depending on order; `linear --version` says which you got (`0.x` ours, `2.x` theirs)
and `which -a linear` lists both. We keep the `linear` name on purpose: it is what every doc,
script and agent skill types, and there is no second name that both projects would agree on. Two
things make it safe anyway:

- We also install **`lin`**, a shorter alias that cannot collide with anything of theirs. If you
  want zero risk of running the wrong tool, use `lin` for the first week — every command in this
  guide works with `lin` in place of `linear`.
- To keep theirs reachable during the transition, rename it to `linear-schpet` the way it was
  installed, and let ours have `linear`:

  ```bash
  deno install -A --reload -f -g -n linear-schpet jsr:@schpet/linear-cli && deno uninstall -g linear   # deno
  brew unlink schpet/tap/linear && ln -s "$(brew --prefix)/opt/linear/bin/linear" ~/.local/bin/linear-schpet  # homebrew
  mv "$(command -v linear)" "$(dirname "$(command -v linear)")/linear-schpet"                                # npm/bun -g
  bun add -g linear-sdk-cli          # or: bun link, from a clone
  linear --version                   # ours: 0.x
  ```

A project-pinned `@schpet/linear-cli` (`bunx linear` inside that repo) never collides with a
global install of ours.

## 2. Credentials — nothing to re-enter

schpet 2.5 stores your API key in the **system keyring** (macOS Keychain or Linux `secret-tool`;
service `linear-cli`, account = workspace slug) and keeps the workspace list in
`~/.config/linear/credentials.toml`. We use the same keyring service and account, and we read that
list file for slugs and its `default` (never for keys), so:

```bash
linear auth status      # Authenticated: true, Source: keychain, Workspace: <your slug>
linear auth list        # …lists it, Storage: keychain
```

If it does not — no keyring on this platform, or you used schpet's plaintext mode (`slug =
"lin_api_…"` inline in `credentials.toml`, which we deliberately do not read) — `linear auth login`
prompts (masked) and stores the key in the keyring; `--plaintext` keeps it in our `0600`
`config.toml` instead. `auth migrate` moves plaintext credentials from that file into the keyring,
same command name as theirs. Because the keyring entry is shared, `auth logout` here removes it for
schpet too (and drops the slug from its list file, so neither tool reports a workspace whose key is
gone). The API key is **never** read from a project `.linear.toml`.

## 3. Config — same files, same keys

We look in every place schpet does, in its order. Walking up from the working directory, each
directory is checked for `linear.toml`, then `.linear.toml`, then `.config/linear.toml` (schpet
checks cwd and the git root; we check every directory between, which agrees with it wherever it
would find something). Below that, our `~/.config/linear/config.toml`, then schpet's global
`~/.config/linear/linear.toml` — read for `team_id`, `workspace`, `issue_sort`, `vcs`; **not** for
`api_key`, which schpet allows there and we never take from any file but our own. `linear config`
prints each value with the file it came from, so nothing is a mystery:

```
Team:           TES  (project: /repo/.config/linear.toml)
Sort:           priority  (global: /Users/you/.config/linear/linear.toml)
```

Two key differences to know: `issue_sort = "manual"` (schpet's board order) has no equivalent here
and is a usage error naming the file — change it to `priority` or drop the line; and schpet's
`issue_create_*`, `download_images`, `hyperlink_format`, `attachment_dir` keys are ignored (no
such features yet). `linear config init` writes a `.linear.toml`; `linear config set <key>
<value>` edits one key.

## 4. Commands — same words, or an alias

| schpet | here | notes |
|---|---|---|
| `issue list` | **`issue mine`** | ⚠️ their `list` is an alias of `mine` (you, unstarted). Our `list` is the whole team. See §6. |
| `issue query` | `issue list` | alias, same command |
| `issue mine` | `issue mine` | same defaults: yours, unstarted; `--all-states` widens |
| `issue comment add\|list\|update\|delete` | same, or top-level `comment …` | one implementation |
| `issue comment <id> "<body>"` | same | |
| `issue attach <file>` | `issue attach <issue> <file...>` | same posture: private by default, `--public` for raster images only; ours takes several files and has `--json` |
| `issue link <url>` | `attachment create --url` | |
| `issue comment add --attach <file>` | same, or `comment add --attach` | repeatable; images render inline |
| `auth whoami` | `whoami` (also `auth whoami`) | |
| `auth migrate` | `auth migrate` | |
| `config` (writes toml) | `config init` / `config set` | |
| `team states` / `team members` / `user list` | same | |
| `document create\|list\|update --project\|--issue\|--initiative\|--team\|--cycle\|--release` | same | `update` re-points, as there; `--team` is the global flag (with `--cycle` it scopes the lookup) |
| `initiative add-project` / `remove-project` / `unarchive` | same | |
| `project delete` / `team delete` | same, confirmation-gated | |
| `schema` / `api` | same | ours adds `--operation`, `--vars-file`, and refuses to `--paginate` a mutation |

Everything with no row is spelled identically.

## 5. Flags — theirs are accepted

| schpet | here (canonical) | where |
|---|---|---|
| `-j, --json` | same | every command |
| `-w, --web` | same | every `view` |
| `--due-date` | `--due` | issue create/update |
| `--target-date`, `--start-date` | `--target`, `--start` | project / milestone / initiative |
| `--search` | `--query` | issue list / mine |
| `--status` | `--state` | project list |
| `--limit 0` | `--all` | every list |
| `--assignee self` | `me` / `@me` | anywhere |
| `--cycle active` | `current` | anywhere; `now`/`next`/`previous`/`+1` also work |
| `-U/--unassigned`, `--created-after`, `--updated-after`, `--project-label`, `--milestone`, `--search-comments`, repeatable `--team`/`--state` | same | issue queries |
| `--add-label`, `--remove-label`, `--unassign`, `--clear-cycle` | same | issue update |
| `--no-use-default-template` | `--no-default-template` | issue create — the team default is applied unless you say so, as there |
| `--start`, `--parent` (child joins the parent's project) | same | issue create |

Passing both spellings at once (`--due` *and* `--due-date`) is a usage error, not a coin flip.

**Short flags are the one place we did not follow.** schpet 2.5's own tree assigns `-a` four
meanings (`--app`, `--all`, `--assignee`, `--attach`), `-f` four, `-y` three, `-t` two (`--title`
and `--team`). There is no consistent target to copy. Ours holds **one meaning per letter across
all 141 commands**, so `-t` is always `--team`, `-p` always `--project`, `-P` always `--priority`.
Every collision fails loudly — `-p 2` says "No project matching '2'", not "set priority 2".

## 6. The three things that would silently differ — and how we made them loud

These are the only spots where the same command could *succeed and return different data*. Know them.

1. **`issue list`** — theirs shows *your unstarted* issues; ours shows the *team's* issues.
   We did not alias `list` to `mine`: a command named "list" that hides your colleagues' work and
   your own in-progress work is the sharpest transition hazard there is. Type `issue mine` for the
   old behavior.
2. **Repeated `--label`** narrows (AND) in both CLIs now — same as schpet.
3. **`--sort priority`** groups by workflow state in both — but we sort state **ascending** so active
   work is on top. schpet hardcodes descending, which the API answers with Backlog *above* In
   Progress; a Low-priority backlog item outranks an Urgent in-progress one there. We diverge on
   purpose.

## 7. Not here yet

`issue commits`, `team autolinks`, jj support, bulk `--bulk-file`, markdown rendering + pager.
Each is tracked; the raw `linear api` reaches all of the API surface in the meantime. If you type
one of these out of habit, the CLI says where the equivalent lives rather than just rejecting it:
`linear issue link x` answers "Use 'linear attachment create <issue> --url <url>'", and `issue
commits` points at `git log`. (`issue attach` is here as of TES-602 — see §4.)

## 8. What you gain

- **One JSON shape everywhere.** Lists are a bare array, single results a bare object, errors
  `{"error":{"message","code"}}` on stderr with distinct exit codes (0–6). schpet wraps in
  `{nodes,pageInfo}` and several of its commands have no `--json` at all.
- **Discovery for agents:** `linear commands --json` (full command tree) and `linear schema`.
- **Broader surface:** notifications, webhooks, favorites, organization, cycle create/update,
  comment resolve/reply, label hierarchy, `issue archive/unarchive`, `issue subscribe`.
- **Every mutation checks `success`**; every resolver scans past the first page and names the
  candidates on a miss; `--json` implies non-interactive; a declined confirmation exits 6.
