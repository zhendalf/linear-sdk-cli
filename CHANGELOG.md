# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
