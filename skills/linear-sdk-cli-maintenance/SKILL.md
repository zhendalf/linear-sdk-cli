---
name: linear-sdk-cli-maintenance
description: "Safely maintain the linear-sdk-cli repository: assess dependency updates, prepare and verify focused pull requests, and hand off releases. Use for scheduled upkeep, dependency reviews, release-automation checks, and maintenance PR reviews in this repository."
---

# linear-sdk-cli maintenance

Use this skill from the repository root. It is deliberately agent-neutral: the same
`SKILL.md` is the source of truth for Codex and Claude Code.

## Invocation modes

- **Review mode (default):** inspect and report only. Do not create branches, commits,
  pull requests, merges, releases, or configuration changes without current user approval.
- **Scheduled autonomous mode:** the calling routine explicitly authorizes the maintenance
  mutations described below. It may create and update PRs and merge a verified,
  dependency-only roll-up PR. It must never push directly to `main`.

If the invocation does not state a mode, use review mode.

## Guardrails

- Start from the current remote `main`; preserve all unrelated local or remote work.
- Never reveal, add, rotate, or work around credentials. Do not modify API keys, auth,
  keychain behaviour, `.env` files, or `.linear.toml` merely to make a check pass.
- Do not weaken tests, linting, CI, branch protection, release checks, or provenance to
  get a green result.
- Treat a failed verification, a conflict, a required reviewer, or a non-green check as a
  stop condition for the affected change. Report the evidence and leave the repository
  recoverable.
- Keep dependency-only changes isolated from source, test, configuration, workflow, or
  documentation changes. Source changes always get their own draft PR and are never
  auto-merged by this skill.
- Use conventional commits. Do not bypass required checks, dismiss reviews, or override
  branch protection.
- For multiline GitHub PR descriptions or comments, write Markdown to a file and use the
  corresponding `--body-file` option. Do not encode line breaks as `\n` inside a quoted
  `--body` argument. Read the published body back once and confirm that headings, paragraphs,
  and lists render as intended.

## Maintenance loop

1. Inspect the current `main`, open maintenance/release PRs, CI status, and repository
   guidance. Confirm tool availability with `bun --version`, `gh auth status`, and the
   repository scripts before changing anything.
2. Survey dependency candidates with `bun outdated`. Group compatible patch/minor updates;
   assess major updates separately. Check each material update's upstream release notes or
   migration guide before proposing it.
3. Prefer one focused dependency roll-up PR for compatible, low-risk updates. Defer an
   update that causes a failure or requires an unverified migration; state its exact version,
   reason, and next action in the report.
4. For every candidate PR, run the repository's required verification:

   ```sh
   bun install
   bun run verify
   bun src/bin/linear.ts --version
   bun src/bin/linear.ts commands --json > /dev/null
   bun run janitor
   ```

   Run `bun run skill:docs` and include generated references whenever a command or option
   changes. Keep the PR scope limited to the intended maintenance category.
5. In scheduled autonomous mode, merge only a dependency-only roll-up PR after all required
   checks are green, the merge is clean, and there are no unresolved review comments. Recheck
   `main` CI after the merge. Otherwise, leave the PR ready for review and report why it was
   not merged.

## Release Please handoff

When a Release Please PR exists, review its diff, mergeability, checks, and discussion.
In scheduled autonomous mode, merge it only when all of the following are true:

- it contains only the expected version and changelog changes;
- required checks are green (or intentionally absent because the automation-created PR cannot
  trigger them, while the exact release commit has already passed `main` CI);
- it is cleanly mergeable with no conflicts, review blockers, or unresolved comments.

After an approved merge, confirm the release workflow completed, then verify the GitHub Release,
the npm package version, and the `latest` dist-tag. npm publishing must retain OIDC provenance.
Never retry a failed publish by adding an npm token or disabling provenance; report the failure.

## Report format

End every run with a short, evidence-backed summary:

- repository/branch and current commit inspected;
- dependency candidates, including deferred items and rationale;
- PRs created, updated, merged, or deliberately left open;
- each verification command and result;
- release status, if applicable; and
- blockers or the next safe action.
