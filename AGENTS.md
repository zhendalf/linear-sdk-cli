# Repository Guidelines

## Project Structure & Module Organization

This is a Bun-first TypeScript CLI; it runs source directly and has no build step. `src/bin/linear.ts` is the executable entry point, while `src/cli.ts` assembles commands. Add command definitions under `src/commands/`, Linear SDK operations under `src/services/`, shared behavior under `src/lib/`, and rendering under `src/output/`. Tests are split into `test/unit/`, `test/contract/`, and credentialed `test/integration/`. The agent skill lives in `skills/linear-sdk-cli/`; its command references are generated. Coverage audit inputs and tooling live in `scripts/`.

## Build, Test, and Development Commands

- `bun install` installs dependencies (Bun 1.1+ required).
- `bun run dev -- issue list` runs the CLI from source.
- `bun run verify` runs TypeScript checks, Oxlint, Oxfmt, and unit/contract tests; use this before submitting.
- `bun run test:unit` or `bun test test/unit/issue-create.test.ts` runs focused tests.
- `bun run test:live` runs end-to-end integration tests with `LINEAR_API_KEY`; admin mutations require `bun run test:live:admin`.
- `bun run skill:docs` refreshes generated skill references after command or option changes.
- `bun run audit:coverage` validates SDK coverage and regenerates `COVERAGE.md`.

## Coding Style & Naming Conventions

Use strict TypeScript with two-space indentation, semicolons, double quotes, trailing commas, and a 100-column target. Run `bun run format` for Oxfmt and `bun run lint` for Oxlint. Use kebab-case filenames (`project-update.ts`), camelCase functions and variables, and PascalCase types. Keep Commander parsing in command modules and API interactions in services. Preserve the contract that JSON mode writes stable machine output to stdout and diagnostics to stderr.

## Testing Guidelines

Tests use `bun:test` and follow `*.test.ts`. Place isolated behavior in unit tests, output-envelope guarantees in contract tests, and real Linear workflows in integration tests. Add focused regression coverage for behavior changes; no percentage threshold is defined. Live fixtures must use the shared helpers and remain gated by environment variables.

## Commit & Pull Request Guidelines

History uses concise conventional prefixes such as `feat:`, `fix:`, `test(live):`, and `docs(parity):`, often ending with a Linear issue like `(TES-610)`. Keep commits scoped and imperative. Pull requests should explain user-visible CLI behavior, link the Linear issue, list verification performed, and include help/JSON output examples when interfaces change. Commit regenerated skill references or coverage files with their source changes.

## Security & Configuration

Never commit API keys or local config. Use `LINEAR_API_KEY` for temporary testing or the OS keyring through `linear auth login`; project-local `.linear.toml` is for non-secret settings only.
