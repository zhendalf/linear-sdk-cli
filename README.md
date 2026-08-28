# linear-sdk-cli

**An ergonomic command-line interface for [Linear](https://linear.app), built on the official
[`@linear/sdk`](https://www.npmjs.com/package/@linear/sdk).**

It's designed to be pleasant for humans _and_ dependable for scripts and agents. By default you
get clean, aligned tables and detail views; add `--json` to any command for a stable,
machine-readable shape. It's git-aware (the "current issue" comes from your branch name) and
forgiving about input (`--assignee me`, team key `TES`, state and label by name). Anything the
curated commands don't wrap is still reachable through a raw GraphQL escape hatch (`linear api`),
so nothing in the Linear API is out of bounds.

```sh
linear issue list --assignee me --state started   # what's on my plate
linear                                              # the issue for the branch you're on
linear issue list --json | jq -r '.[].identifier'  # ready for scripts
```

> Design influenced by [`schpet/linear-cli`](https://github.com/schpet/linear-cli) (human-first,
> git-aware) and [`linearis`](https://github.com/linearis-oss/linearis) (JSON-first for agents).

## Highlights

- **Human-first by default** — aligned tables, rendered Markdown, safe paging for long detail,
  color controls, and a clear notice when a list was truncated.
- **Agent- and script-friendly** — every data command takes `--json` and emits a stable, documented envelope on stdout; status text stays on stderr.
- **Git-aware** — the current issue is inferred from your branch (`tes-123-fix` → `TES-123`), so most issue commands let you drop the id.
- **Git + GitHub workflow** — `issue start` checks out the branch and marks the issue started, `issue describe` prints a commit message with Linear-issue trailers, `issue pr` opens a GitHub PR — all linked back to the issue.
- **Forgiving inputs** — refer to things the way you think of them: `TES-123`, team `TES`, `--assignee me`, `--cycle current`, state and label by name.
- **Multi-workspace** — store credentials for several workspaces and switch with a global `--workspace`.
- **Complete & honest** — first-class commands for the core resource graph, a raw `linear api` for everything else, and a [measured coverage audit](#coverage) that CI keeps honest.

## Install

Requires [Bun](https://bun.sh) **1.1 or newer** and a Linear API key
(Settings → Security & access → **Personal API keys**). The CLI ships as TypeScript and runs
directly on Bun — no build step, no bundle, no Node.

```sh
bun add --global linear-sdk-cli
lin --help
```

This installs two equivalent binaries: **`linear`** and the shorter **`lin`**. If you already
have a different tool named `linear` on your `PATH`, just use `lin`.

### If you already have `schpet/linear-cli` installed

Both CLIs install a binary called **`linear`**, so whichever is earlier on your `PATH` wins and
the other is silently shadowed — `linear --version` tells you which you got (`0.x` is this one,
`2.x` is schpet's), and `which -a linear` lists both. Three ways out, pick one:

- **Use `lin`.** It is ours alone; nothing of theirs claims it. Every example in this README works
  with `lin` in place of `linear`. Zero-risk for the transition week.
- **Keep theirs reachable as `linear-schpet`** and let ours have `linear`:

  ```sh
  # installed with deno: reinstall under a new name, then drop the old one
  deno install -A --reload -f -g -n linear-schpet jsr:@schpet/linear-cli
  deno uninstall -g linear
  # installed with homebrew (schpet/tap/linear): keep the keg, relink under a new name
  brew unlink schpet/tap/linear
  ln -s "$(brew --prefix)/opt/linear/bin/linear" ~/.local/bin/linear-schpet   # any dir on your PATH
  # installed with npm/bun globally: rename the shim in place
  mv "$(command -v linear)" "$(dirname "$(command -v linear)")/linear-schpet"
  ```

  (A package-manager upgrade of theirs may put `linear` back; re-run the line for your channel.)

- **Uninstall theirs** once you no longer need it. Your credentials survive: they are in the OS
  keyring under the same service and account, and we read them — see [Authentication](#authentication).

Their project-pinned install (`bun add -D @schpet/linear-cli`, run as `bunx linear`) does not
collide with a global install of ours; inside such a project `bunx linear` is theirs and
`linear`/`lin` on your `PATH` is ours.

<details>
<summary>Run from source instead</summary>

```sh
git clone https://github.com/zhendalf/linear-sdk-cli.git && cd linear-sdk-cli
bun install
bun run src/bin/linear.ts --help     # or: bun run dev -- --help
```

</details>

## Quickstart

```sh
export LINEAR_API_KEY=lin_api_xxxxxxxx     # quickest way to get going
linear whoami                              # confirm you're connected

linear issue list --assignee me --state started        # my in-progress work
linear issue view TES-42                                # full detail
linear issue create --title "Fix login" --team TES -P 2 # new High-priority issue
linear issue start TES-42                               # check out its branch + mark it started
linear issue comment TES-42 "shipped — please review"
```

In a git repository, bare `linear` (and `linear issue`) shows the issue inferred from the current
branch, so most issue commands let you omit the id entirely.

## Authentication

For a person at a terminal, `linear auth login` uses browser Authorization Code + PKCE and the
default `actor=user`. Existing personal API keys and invocation-scoped OAuth access tokens remain
supported. Explicit `--api-key` or `--access-token` flags override environment credentials;
without a credential flag the CLI reads `LINEAR_API_KEY` or `LINEAR_ACCESS_TOKEN`. If both kinds
are supplied at the same precedence level, the CLI fails rather than silently choosing a Linear
actor.

> **Credential trust boundary.** A secret is **never** read from a project-local
> `.linear.toml` — only non-secret settings live there — so a key can't be committed by accident.
> A project may select one of your already-stored credentials with `workspace = "<slug>"`, but it
> cannot provide or override the secret. Browser OAuth credentials are keyring-only; an access
> token injected with `--access-token` or `LINEAR_ACCESS_TOKEN` remains invocation-scoped.

```sh
linear auth login                          # browser OAuth, read + write, actor=user
linear auth login --read-only              # request only Linear's read scope
linear auth login --no-browser             # print the URL; still waits on the loopback callback
printf '%s\n' "$LINEAR_API_KEY" | linear auth login --key -  # personal API-key fallback
linear auth status                         # credential kind and source (value redacted)
linear auth logout --workspace acme        # revoke OAuth (if used) and remove the profile
```

Browser login generates a cryptographically random verifier and CSRF state, requires PKCE S256,
opens Linear, and listens temporarily on the registered `127.0.0.1` callback. It validates the
viewer and workspace before saving the access token, rotating refresh token, expiry, granted
scopes, OAuth client identity, and workspace identity. The whole record lives only in the system
keyring (`service = linear-cli`, `account = oauth:<workspace slug>`); the config file gets only
non-secret `keyring = true` and `oauth = true` markers. Access tokens refresh before expiry and
once after an authentication failure, with refresh-token rotation committed under the credential
store lock. `--admin` explicitly adds the admin scope; it is never implicit.

`--no-browser` is useful over SSH only when the machine running the CLI is also reachable as the
browser's loopback host; Linear does not currently document a device-code flow. Override a
separately registered public client's identity with `LINEAR_OAUTH_CLIENT_ID` and its exact callback
with `LINEAR_OAUTH_REDIRECT_URI`. No OAuth client secret is embedded, accepted, or stored.

For a personal API key, `auth login --key -` reads stdin, validates the viewer/workspace, stores the
key in the system keyring by default, and writes only a marker to the config. `--plaintext` is an
API-key-only compatibility option. API-key entries use `account = <workspace slug>`, matching
[schpet/linear-cli](https://github.com/schpet/linear-cli). Passing a key as `--key <value>` works but
warns because argv is visible to other processes. `auth migrate` moves legacy plaintext keys into
the keyring, and `auth token` exports stored API keys only; OAuth tokens are never printed.

### Apps, agents, and service accounts

Use an OAuth access token when the CLI runs inside an integration or agent:

```sh
LINEAR_ACCESS_TOKEN="$access_token" linear whoami --json
LINEAR_ACCESS_TOKEN="$access_token" linear issue list --json
```

The application host owns OAuth installation, refresh-token or client-credentials exchange,
client-secret storage, and webhook processing; it injects only the current access token into each
CLI invocation. The CLI passes it to `LinearClient({ accessToken })`, which sends the required
Bearer authorization. Prefer the environment variable because a command-line token is visible to
other processes and shell history.

For a long-lived, single-workspace host, enable client credentials on the Linear OAuth app and keep
its client ID and secret in the host's secret manager. The package exports an expiry-aware provider
that caches Linear's 30-day app-actor token in memory, coalesces concurrent exchanges, renews five
minutes before expiry, and can be forced to renew after a `401`:

```ts
import { ClientCredentialsTokenProvider } from "linear-sdk-cli";

const { LINEAR_CLIENT_ID: clientId, LINEAR_CLIENT_SECRET: clientSecret, ...childEnv } = process.env;
if (!clientId || !clientSecret) throw new Error("Linear OAuth credentials are missing");

const tokens = new ClientCredentialsTokenProvider({
  clientId,
  clientSecret,
  scopes: ["read", "write"],
});

const { accessToken } = await tokens.getAccessToken();
const child = Bun.spawn(["linear", "issue", "list", "--json"], {
  env: { ...childEnv, LINEAR_ACCESS_TOKEN: accessToken },
});
await child.exited;
```

Call `tokens.invalidate()` (or `getAccessToken({ forceRefresh: true })`) before one bounded retry
when Linear rejects the token with `401`. Client-credentials tokens do not have refresh tokens;
renewal is another authenticated exchange. A short-lived/serverless process should use a secure
shared token cache or central broker rather than minting a new 30-day token on every invocation.

For an app installed into multiple workspaces, use Authorization Code with `actor=app` instead and
store each installation's rotating refresh token encrypted in the host. That hosted app lifecycle
remains distinct from this CLI's browser PKCE login for a human `actor=user`.

For a distinct app identity, install the OAuth application with `actor=app`. Native Linear agents
can additionally request `app:mentionable` and `app:assignable` and subscribe to Agent Session
webhooks. App actors cannot request the `admin` scope. See Linear's
[OAuth guide](https://linear.app/developers/oauth-2-0-authentication),
[app-actor authorization](https://linear.app/developers/oauth-actor-authorization), and
[agent guide](https://linear.app/developers/agents).

Hosted app tokens supplied through `LINEAR_ACCESS_TOKEN` remain invocation-scoped. The only OAuth
tokens persisted by the CLI are human browser-login sessions, stored as an isolated per-workspace
keyring record; the CLI never persists or uses an OAuth client secret.

### Multiple workspaces

Credentials are stored per **workspace slug**. Browser and API-key login both derive the slug from
the authenticated organization; `--workspace` validates that the result matches:

```sh
linear auth login --workspace acme         # browser OAuth for "acme"
linear auth login --workspace other-org    # …and another workspace
linear auth login --workspace acme --key - # personal API-key fallback via stdin
linear auth list                           # show configured workspaces + which is default
linear auth default acme                   # choose the default workspace
linear --workspace other-org issue list    # use a specific workspace for one command
linear auth logout --workspace acme        # revoke OAuth, then remove one credential
```

If revocation is intentionally unavailable, `auth logout --local-only` removes only local state.
If browser login temporarily superseded an existing personal API-key profile for that workspace,
OAuth logout preserves and reactivates the API key instead of deleting it.

**Selection precedence** (strict): an explicit `--api-key` or `--access-token` flag bypasses the
environment and workspace selection entirely. Otherwise `LINEAR_API_KEY` or
`LINEAR_ACCESS_TOKEN` is absolute. With no invocation-scoped credential, the workspace is chosen
by `--workspace` → `LINEAR_WORKSPACE` env → project config `workspace` → `default_workspace` in the
user config. With one configured workspace it's used automatically; with several and no selection,
the CLI asks you to pick (via `--workspace`, project config, or `auth default`).

## Core concepts

A few ideas run through every command:

- **Git-branch awareness.** On a `tes-123-*` branch, bare `linear` shows `TES-123` (identical to
  `issue view TES-123`), and nearly every issue subcommand infers the id from the branch — so
  `linear issue comment "…"`, `linear issue start`, `linear issue pr` all "just work" in context.
- **Human by default, `--json` for machines.** Without `--json` you get tables and detail views
  meant to be read. With `--json`, stdout carries _only_ machine JSON (a [stable
  envelope](#scripting--agents)); status and progress always go to stderr.
- **Forgiving inputs.** Resolve things by how you think about them: `--assignee me`, assignee by
  email or name, team key `TES`, `--cycle current`, workflow state and label by name (case-
  insensitively). Ambiguous names produce a clear error (exit `3`), not a wrong guess.

## Common workflows

**Issue lifecycle**

```sh
linear issue create --title "Fix login redirect" --team TES -P 2 --assignee me
linear issue list --assignee me --state started
linear issue update TES-42 --state "In Review" --add-label backend
linear issue comment TES-42 "ready for another look"
linear issue archive TES-42 --yes
```

**Git + GitHub PR** — turn an issue into commits and a pull request. The id is inferred from the
branch everywhere below.

```sh
linear issue start TES-123                 # checkout tes-123-* branch and mark it started (--no-move: branch only)
git commit -m "$(linear issue describe)"   # "TES-123 Title" + Linear-issue trailers
linear issue pr                             # open a GitHub PR titled "TES-123 Title", body = the trailers
linear issue pr --draft --base main        # …as a draft against a specific base
linear issue pr --json | jq -r .url        # the created PR URL is the only thing on stdout
```

`issue describe` prints a whole commit message — `TES-123 Title`, a blank line, then two git
trailers, `Linear-issue: Fixes TES-123` and `Linear-issue-url: <url>` (the same text
schpet/linear-cli prints, so `git interpret-trailers` and jj read it back). The magic word sits
right before the id, which is where Linear's
[git integration](https://linear.app/docs/github#link-prs-and-commits) reads it, so the issue is
linked — and closed on merge — when the commit lands; `-r` swaps in `References` to link without
closing. `issue pull-request` (alias `pr`) opens the PR via the [`gh`](https://cli.github.com) CLI:
title `TES-123 Title` (a custom `--title` is prefixed the same way), body the same two trailers,
so the PR and issue reference each other; the issue description stays in Linear. It never pushes
or creates branches for you, and fails with a clear error (not a stack trace) when `gh` is
missing, unauthenticated, or the branch isn't pushed.

**Comments & explicit mentions** — ordinary `@name` text stays literal and never notifies anyone.
Use repeatable `--mention <name|email|me|id>` when a real Linear mention is intentional; the CLI
resolves each user exactly, deduplicates repeats, and prepends the mentions as their own Markdown
paragraph. The flag works on `issue comment`, `comment add`, `comment reply`, and `comment update`
(including the `issue comment add/update` aliases).

```sh
linear issue comment TES-123 "Please review this." --mention ada
linear comment add TES-123 --mention ada --mention grace --body-file - <<'EOF'
The migration plan is ready for review.
EOF
```

**Projects & status updates**

```sh
linear project list --team TES
linear project view "Q3 Launch"
linear project-update create "Q3 Launch" --health onTrack --body "Beta is out to 10% of users."
linear initiative-update create "Platform" --health atRisk --body-file update.md
```

Status updates (`project-update`/`pu`, `initiative-update`/`iu`) take the body from `--body`,
`--body-file <path>` (`-` for stdin), or `--editor` (`$EDITOR`), plus an optional
`--health <onTrack|atRisk|offTrack>`.

## Command overview

Every group has `--help` with full options and (for the busy ones) an Examples section. Aliases
are shown in parentheses. For a machine-readable tree of _every_ command, run
`linear commands --json`.

| Group                          | What you can do                                                                                                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`issue`** (`i`)              | `view` · `list` · `mine` · `search` · `create` · `update` · `delete` · `archive`/`unarchive` · `start` (git branch) · `describe` · `pull-request`/`pr` · `assign` · `state` · `label` · `comment`/`comments` · `relation` · `subscribe`/`unsubscribe` · `id`/`title`/`url`/`branch` |
| **`team`** (`t`)               | `list` · `view` · `members` · `states` · `labels` · `cycles` · `create` · `update`                                                                                                                                                                                                  |
| **`project`** (`p`)            | `list` · `view` · `create` · `update` · `archive` · `milestones`                                                                                                                                                                                                                    |
| **`project-update`** (`pu`)    | `create` · `list` (project status updates, with `--health`)                                                                                                                                                                                                                         |
| **`milestone`** (`m`)          | `list` · `view` · `create` · `update` · `delete`                                                                                                                                                                                                                                    |
| **`cycle`** (`c`)              | `list` · `view` · `current` · `create` · `update`                                                                                                                                                                                                                                   |
| **`user`** (`u`)               | `list` · `view` · `me`                                                                                                                                                                                                                                                              |
| **`label`** (`lb`)             | `list` · `create` · `update` · `delete`                                                                                                                                                                                                                                             |
| **`state`** (`st`)             | `list` · `view` (workflow states)                                                                                                                                                                                                                                                   |
| **`comment`** (`cm`)           | `list` · `add` · `reply` · `update` · `delete` · `resolve`/`unresolve`                                                                                                                                                                                                              |
| **`document`** (`doc`)         | `list` · `view` · `create` · `update` · `delete`                                                                                                                                                                                                                                    |
| **`attachment`** (`at`)        | `list` · `create` · `delete`                                                                                                                                                                                                                                                        |
| **`favorite`** (`fav`)         | `list` · `add` · `remove`                                                                                                                                                                                                                                                           |
| **`initiative`** (`init`)      | `list` · `view` · `create` · `update` · `archive` · `delete`                                                                                                                                                                                                                        |
| **`initiative-update`** (`iu`) | `create` · `list` (initiative status updates, with `--health`)                                                                                                                                                                                                                      |
| **`roadmap`** (`rm`)           | `list` · `view` · `create` · `update` · `delete` &nbsp;<sup>†</sup>                                                                                                                                                                                                                 |
| **`notification`** (`notif`)   | `list` · `read`/`unread` · `read-all` · `archive` · `snooze`                                                                                                                                                                                                                        |
| **`organization`** (`org`)     | `view` · `members` · `invites`                                                                                                                                                                                                                                                      |
| **`webhook`** (`wh`)           | `list` · `view` · `create` · `update` · `delete`                                                                                                                                                                                                                                    |
| **top-level**                  | `whoami` · `auth` (`login` · `list` · `default` · `token` · `status` · `logout`) · `config` · `api` · `commands` · `schema` · `completion`                                                                                                                                          |

<sup>†</sup> Linear has **deprecated roadmaps** in favor of initiatives — reads still work, but the
API rejects roadmap mutations with a deprecation notice. Use `initiative` for new work.

### Global flags

| Flag                        | Effect                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `--json`                    | Emit machine JSON only on stdout (see [the contract](#scripting--agents)).                                                |
| `-f, --fields a,b,c`        | Choose which columns to show (table output), detail lines, or JSON keys. Refused on a command that prints only a receipt. |
| `-n, --limit <n>` / `--all` | Cap results, or fetch every page. Refused on a command that pages nothing.                                                |
| `-t, --team <key>`          | Set the default team for the command.                                                                                     |
| `--workspace <slug>`        | Select which stored workspace credential to use.                                                                          |
| `-y, --yes`                 | Skip confirmation prompts (required for destructive actions when not a TTY).                                              |
| `--no-input`                | Never prompt; fail with a usage error instead of hanging.                                                                 |
| `--no-ansi`                 | Disable colored output (`--no-color` is accepted as an alias).                                                            |
| `-q, --quiet` · `--debug`   | Silence status output · verbose errors.                                                                                   |

## Scripting & agents

The CLI is built to be driven by scripts and agents. Everything in this section is a stable
contract.

**The `--json` envelope.** With `--json`, stdout carries _only_ machine JSON, pretty-printed, one
value per command:

- **list** commands emit a **bare array** (`[...]`) — even when empty (`[]`) and even for a single result.
- **single-resource** commands (`view`, `whoami`, …) emit a **bare object** (`{...}`).
- **mutations** (`create`/`update`/`delete`/`archive`/…) emit the affected object — typically a
  small shape like `{ "id", "identifier", "url" }`, or `{ "id", "success": true }` when the API
  returns no body. Destructive commands add a flag such as `{ "deleted": true }` / `{ "archived": true }`.
- **errors** go to **stderr** as `{"error":{"message":"…","code":"…"}}` and never to stdout. With
  `--debug`, the extra detail is carried _inside_ that object as `error.detail` rather than appended
  after it, so `--json --debug` output stays parseable.

Status, progress, and pagination notes always go to **stderr**, so `cmd --json` is safe to pipe
into `jq` unconditionally:

```sh
linear issue list --json | jq -r '.[].identifier'
linear issue view TES-42 --json | jq -r '.url'
ID=$(linear issue create --title "Fix" --team TES --json | jq -r '.id')
```

**Exit codes** are stable and distinct, so a script can branch on the failure class:

| Code | Name                | When                                                                |
| ---: | ------------------- | ------------------------------------------------------------------- |
|  `0` | ok                  | success                                                             |
|  `1` | runtime/API         | network/GraphQL/other runtime failure (also feature-not-accessible) |
|  `2` | usage               | bad flags/arguments, missing required input, validation             |
|  `3` | not-found/ambiguous | the referenced resource doesn't exist, or a name matched many       |
|  `4` | auth                | missing/invalid API key, or forbidden                               |
|  `5` | rate-limited        | Linear rate limit hit                                               |
|  `6` | cancelled           | a confirmation prompt was declined — nothing was changed            |

The error `code` field in the JSON envelope is one of: `usage`, `auth`, `not_found`, `ambiguous`,
`forbidden`, `validation`, `rate_limited`, `network`, `feature_not_accessible`, `api`, `runtime`.
Several map to the same exit code (e.g. `ambiguous` → `3`, `validation` → `2`, `forbidden` → `4`),
so prefer the `code` field for fine-grained handling and the exit code for coarse branching.

**Non-interactive flags** make runs deterministic in CI and agent loops:

- **`--no-input`** — never prompt; anything that would be prompted for becomes a usage error
  (exit `2`) instead of hanging. Use this whenever there's no human at the keyboard. **`--json`
  implies this**, as does a stdout that is not a TTY: a prompt inside a pipeline is a hang, not a
  question, so you never have to remember both flags.
- **`-y, --yes`** — pre-confirm destructive actions (`delete`/`archive`). Without a TTY,
  destructive commands _require_ `--yes` (they refuse rather than block). If a human declines the
  prompt, the command exits **`6`** and reports `{"cancelled": true, "action": "…"}` under `--json`
  — never `0`, so `linear issue delete X && …` cannot run the `&&` side after a "no".
- **`-q, --quiet`** — suppress success/status lines on stderr (errors still print).
- **`-n, --limit <n>` / `--all`** — `--limit` caps results; `--all` exhausts pagination. With
  neither, the default cap is **50**. `--all` (and very large `--limit`) can be slow and
  rate-limit-prone on big workspaces.

```sh
# agent-safe: no prompts, no chatter, fail fast with a parseable error
linear issue delete TES-42 --yes --no-input --quiet --json
```

**Discovery — learn the surface without scraping `--help`:**

- **`linear commands --json`** — a bare array of `{ path, description, aliases, arguments, options }`
  for every (sub)command, so an agent can enumerate what's available and how to call it.
- **`linear schema`** — the Linear GraphQL schema as SDL (`-o, --output <file>` writes to a file;
  `--json` prints raw introspection). Pair it with `linear api` to reach anything the curated
  commands don't wrap.

```sh
linear commands --json | jq -r '.[].path'      # every command path
linear schema -o /tmp/linear.graphql            # dump SDL, then explore
grep 'type Issue ' /tmp/linear.graphql
```

**File-based bodies & stdin.** Long text (issue descriptions, comments, status updates) can come
from a file or stdin instead of a flag — e.g. `--body-file <path>` with `-` for stdin, or
`--editor` to open `$EDITOR`. The raw `linear api` reads from `--query-file -` and `--vars-file -`
too, so you can pipe GraphQL straight in. Inline bodies containing literal `\n` sequences are
rejected with this guidance: ordinary shell quotes do not convert them into line breaks.
Literal `@name` text is also preserved. To create a notification-capable Linear mention, pass the
repeatable `--mention <name|email|me|id>` option on a comment-writing command.

**Agent skills.** This repo ships portable agent skills in `skills/`: `linear-sdk-cli` teaches an
agent to drive the CLI, while `linear-sdk-cli-maintenance` defines the repository's safe upkeep
and release-handoff contract. Both use `SKILL.md` so one source works with Codex and Claude Code.
Claude Code receives both skills when the repository plugin is installed:

```bash
# Claude Code — as a plugin (the repo is its own marketplace)
claude plugin marketplace add <owner>/linear-sdk-cli
claude plugin install linear-sdk-cli

# from a clone or install, make a portable SKILL.md available to an agent:
ln -s "$PWD/skills/linear-sdk-cli" ~/.claude/skills/linear-sdk-cli
```

For Codex, install or link the same directory into its skills location; no forked prompt is
needed. The scheduled Claude Code maintenance routine invokes
`skills/linear-sdk-cli-maintenance/SKILL.md` directly, keeping its schedule separate from the
versioned maintenance policy. See [`skills/README.md`](skills/README.md) for the interoperability
contract.

The CLI skill is self-contained: an agent that has only the skill and no CLI is told to
`bun add -g linear-sdk-cli`, and one arriving from `schpet/linear-cli` is told not to re-enter a
key before `linear auth status`, since existing credentials are found. `linear commands --json`
gives it the full command surface at runtime, so the reference docs are a starting point, not a
cage.

## Coming from linear-cli

> The full guide — install without a collision, credentials found without a re-login, config
> read from the same files, and the three places the two CLIs would silently differ — is
> [`MIGRATING.md`](MIGRATING.md). This section is the flag-level cheat sheet.

If your fingers or your scripts learned the other `linear-cli`, most of its spellings work here
unchanged. The left column is theirs, the right is the canonical one this CLI documents and prints
in `--help`; both are accepted, and passing both at once is a usage error rather than a silent pick.

| linear-cli                                | here                   | where                                              |
| ----------------------------------------- | ---------------------- | -------------------------------------------------- |
| `-j, --json`                              | same                   | every command (global)                             |
| `-w, --web`                               | same                   | `issue view`, `issue pull-request`                 |
| `--due-date`                              | `--due`                | `issue create`, `issue update`                     |
| `--target-date`                           | `--target`             | `project`/`milestone`/`initiative` create & update |
| `--start-date`                            | `--start`              | `project create`, `project update`                 |
| `--search`                                | `--query`              | `issue list`, `issue mine`                         |
| `--status`                                | `--state`              | `project list`                                     |
| `--all-states`                            | (no-op)                | `issue list` — it already spans every state        |
| `--limit 0`                               | `--all`                | every list; `--all` is the spelling we teach       |
| `--assignee self`                         | `me` / `@me`           | anywhere a user is named                           |
| `--cycle active`                          | `current`              | anywhere a cycle is named                          |
| `--cycle "<name>"`                        | number, name, or id    | all three resolve                                  |
| `issue query`                             | `issue list`           | same command                                       |
| `auth whoami`                             | `whoami`               | both spellings registered                          |
| `issue comment add\|list\|update\|delete` | `comment add\|list\|…` | both mounted on one implementation                 |

Their query filters all exist here too, under the same names — `issue list`, `issue mine` and
`issue search` share one filter set:

| linear-cli                           | here                | notes                                                                                                                                                           |
| ------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-U, --unassigned`                   | same                | `issue list`/`search`; passing it with `--assignee` is a usage error                                                                                            |
| `--team A --team B`                  | same                | repeatable **on the three issue queries only**; elsewhere `--team` is the single default-team global                                                            |
| `--state a --state b`                | same                | repeatable; several states OR together (an issue is in one state), and each value is a state name _or_ type                                                     |
| `--created-after`, `--updated-after` | same                | `YYYY-MM-DD` or ISO 8601, inclusive; a malformed date is rejected locally instead of returning an empty list                                                    |
| `--project-label`                    | same                | matches the _project's_ label; mutually exclusive with `--project`                                                                                              |
| `--milestone`                        | same                | theirs requires `--project`; here that scoping is optional — without it the milestone is matched by name across projects                                        |
| `--search-comments`                  | `--search-comments` | `issue search` only — the plain list query has nowhere to put it                                                                                                |
| `issue update --team`                | same                | a real team move: the issue is renumbered, and Linear remaps its state while dropping the cycle, team-scoped labels and any project the new team is not part of |

Four differences we deliberately did **not** adopt: their
`issue list` is an alias of `mine` (a `list` that silently filters to you and hides started work is
the worst transition hazard, so we added `issue mine` instead of changing `list`); their JSON shape
wraps results in connection envelopes and `mine` has no `--json` at all (our uniform bare
array/object is the point); their short flags are reassigned per command (`-t` is both `--title`
and `--team` in their own tree, so there is no coherent target to match); and their per-command
option model, where we keep true globals.

## Configuration

Non-secret defaults live in `~/.config/linear/config.toml` (user-wide) or a project-local config
file. **Secrets never go in a project file** — the API key is only ever read from the flag, the
env, the user config, or the OS keyring.

Precedence, highest first — `linear config` prints each value with the tier and file it came from:

1. the flag (`--team`, `--workspace`, `--sort`)
2. the environment (`LINEAR_TEAM`/`LINEAR_TEAM_ID`, `LINEAR_WORKSPACE`, `LINEAR_ISSUE_SORT`)
3. the **project config**: the first file found walking up from the working directory, checking in
   each directory `linear.toml`, then `.linear.toml`, then `.config/linear.toml` — the same
   names and order as [schpet/linear-cli](https://github.com/schpet/linear-cli), so a repo set
   up with its `linear config` (which writes `<git root>/.config/linear.toml`) is picked up as-is
4. the **user config**, `~/.config/linear/config.toml` (`$XDG_CONFIG_HOME` honored)
5. schpet/linear-cli's **global config**, `~/.config/linear/linear.toml` — read for non-secret
   settings only, so a migrating user's defaults carry over

Keys: `team` (or `team_id`), `workspace`, and `sort` (or `issue_sort`). You can write these from
the CLI — comments and layout in an existing file are preserved, and the write is atomic:

```sh
linear config init                    # pick a team from a list → <git root>/.linear.toml
linear config init --team TES         # …or say which (scripts); --sort, --path, --force
linear config set sort updated        # edit one key in the project config in effect
linear config set team ENG --user     # …or in ~/.config/linear/config.toml
linear config                         # show the result, with each value's source
```

`config set` will not write `api_key` or anything else that belongs to the credential store — that
is what `auth login` is for.

```toml
# ~/.config/linear/config.toml
default_workspace = "acme"     # which stored credential is active
team = "TES"                   # default team key
sort = "priority"              # default issue-list sort: priority | updated | created

[workspaces."acme"]            # per-workspace credentials (hyphenated slugs are quoted)
keyring = true                 # secret lives in the OS keyring (service linear-cli, account acme)
[workspaces."other-org"]
api_key = "lin_api_yyyyyyyy"   # …or, with `auth login --plaintext`, in this 0600 file
```

Relevant environment variables: **`LINEAR_API_KEY`** or **`LINEAR_ACCESS_TOKEN`** (absolute —
bypasses workspace selection) and **`LINEAR_WORKSPACE`** (selects a stored API-key credential when
no invocation-scoped credential is given).

### Shell completion

```sh
source <(linear completion bash)                         # bash — add to ~/.bashrc
source <(linear completion zsh)                          # zsh  — add to ~/.zshrc
linear completion fish > ~/.config/fish/completions/linear.fish
```

## Raw API escape hatch

Anything without a tailored command is reachable through raw GraphQL — queries or mutations, from
an argument, a file, or stdin, with variables and optional auto-pagination:

```sh
linear api '{ viewer { id name } }'
linear api 'query($id:String!){ issue(id:$id){ title } }' --var id=TES-1
echo '{ teams { nodes { key name } } }' | linear api --query-file -
linear api --query-file q.graphql --vars-file vars.json --paginate
```

Use `linear schema` to discover types and fields first, then reach for `linear api`.

### Coverage

Coverage of the SDK is **measured, not asserted.** `linear api` reaches the full GraphQL API, and
a generated audit ([COVERAGE.md](./COVERAGE.md)) classifies every one of the ~460 `LinearClient`
members as `curated` (a first-class command), `raw-only` (reachable via `linear api`), or
`excluded` (admin/integration/SDK plumbing). CI fails on any drift from the committed snapshot, so
the claim stays honest as the SDK evolves.

## Programmatic use

The CLI can also be embedded:

```ts
import { createProgram } from "linear-sdk-cli";

await createProgram().parseAsync(["node", "linear", "issue", "list", "--json"]);
```

## Development

```sh
bun run verify           # typecheck + lint + unit/contract tests
bun run test:live        # live integration tests (needs LINEAR_API_KEY + LINEAR_CLI_LIVE=1)
bun run test:live:admin  # also runs admin-tier suites (e.g. team create/update)
bun run audit:changelog  # verify package, tag, and generated release-note history
bun run audit:coverage   # regenerate COVERAGE.md (add --update to re-baseline the snapshot)
bun run janitor          # sweep leaked `clitest-` fixtures from the test workspace
```

Architecture is three layers — **commands** (commander wiring) → **services** (one module per
resource, the only place that touches the SDK) → **`@linear/sdk`**. The machine JSON envelope is
locked and contract-tested so output never silently drifts.

Release Please owns `CHANGELOG.md`. Pull requests use Conventional Commit titles and are squash
merged, giving each change one release-note entry. Do not edit the changelog in a feature or fix
pull request; use a `BEGIN_COMMIT_OVERRIDE` block in the pull request body when a change needs
several or specially worded release notes.

> Live integration tests run against a real workspace and share one API key; running the entire
> suite repeatedly can hit Linear's rate limit. Run a subset (a few files at a time) or re-run
> after a short pause if you see transient rate-limit failures.

## License

[MIT](./LICENSE) © Eugene Beloded
