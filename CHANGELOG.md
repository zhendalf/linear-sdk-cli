# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
